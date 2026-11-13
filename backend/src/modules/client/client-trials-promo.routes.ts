import { Router } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig, validatePromoCode } from "./client.service.js";
import { activateFreeDaysPromo, PromoCodeError } from "../promo-code/free-days.service.js";
import { remnaCreateUser, remnaUpdateUser, isRemnaConfigured, remnaGetUser, remnaGetUserByUsername, remnaGetUserByEmail, remnaGetUserByTelegramId, extractRemnaUuid, remnaUsernameFromClient } from "../remna/remna.client.js";
import { upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";
import { isMultiSubscriptionsEnabled } from "./multi-subscriptions.js";
import { requireRemnaOnline } from "./client.middleware.js";
import { toClientShape } from "./client-auth.routes.js";

export const clientTrialsPromoRouter = Router();

/** Извлекает текущий expireAt из ответа Remna. Возвращает Date если в будущем, иначе null. */
export function extractCurrentExpireAt(data: unknown): Date | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o.data ?? o) as Record<string, unknown>;
  const raw = resp?.expireAt;
  if (typeof raw !== "string") return null;
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime() > Date.now() ? d : null;
  } catch {
    return null;
  }
}

/** Считает expireAt: если текущая подписка активна — добавляет дни к ней, иначе от now. */
export function calculateExpireAt(currentExpireAt: Date | null, durationDays: number): string {
  const base = currentExpireAt ?? new Date();
  return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

clientTrialsPromoRouter.post("/trial", requireRemnaOnline, async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; trialUsed: boolean; email: string | null; telegramId: string | null; telegramUsername?: string | null } }).client;
  if (client.trialUsed) {
    return res.status(400).json({ message: "Бесплатный тест уже использован" });
  }
  const config = await getSystemConfig();
  const trialDays = config.trialDays ?? 0;
  const trialSquadUuid = config.trialSquadUuid?.trim() || null;
  if (trialDays <= 0 || !trialSquadUuid) {
    return res.status(503).json({ message: "Бесплатный тест не настроен" });
  }
  if (!isRemnaConfigured()) {
    return res.status(503).json({ message: "Сервис временно недоступен" });
  }

  // single-режим (мульти-подписки ВЫКЛ): у клиента может быть только ОДНА подписка.
  // Если подписка (не подарок) уже есть — триал вторым не выдаём. В мульти-режиме
  // (по умолчанию) — как раньше, триал доступен параллельно.
  if (!isMultiSubscriptionsEnabled(config)) {
    const existingSubs = await prisma.subscription.count({
      where: { ownerId: client.id, purchasedAsGift: false, giftStatus: null },
    });
    if (existingSubs > 0) {
      return res.status(400).json({ message: "Бесплатный тест недоступен — у вас уже есть подписка." });
    }
  }

  const trafficLimitBytes = config.trialTrafficLimitBytes ?? 0;
  const hwidDeviceLimit = config.trialDeviceLimit ?? null;

  let workingUuid = client.remnawaveUuid;

  if (workingUuid) {
    const checkRes = await remnaGetUser(workingUuid);
    if (checkRes.error || !checkRes.data) {
      console.warn(`[trial] Remna user ${workingUuid} not found (status ${checkRes.status}), will re-create`);
      workingUuid = null;
      await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
    }
  }

  if (workingUuid) {
    const userRes = await remnaGetUser(workingUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);

    // Защита от перезаписи платной подписки: если у клиента уже активна подписка
    // (expireAt в будущем) с непустыми squads, которые НЕ равны [trialSquadUuid],
    // значит действует платный/подарочный тариф. Триал не должен затирать его параметры
    // (squads, traffic limit, device limit).
    const resp = (userRes.data && typeof userRes.data === "object"
      ? ((userRes.data as Record<string, unknown>).response ?? (userRes.data as Record<string, unknown>).data ?? userRes.data)
      : null) as Record<string, unknown> | null;
    const currentSquadsRaw = Array.isArray(resp?.activeInternalSquads) ? (resp?.activeInternalSquads as unknown[]) : [];
    const currentSquads: string[] = [];
    for (const s of currentSquadsRaw) {
      const u = s && typeof s === "object" && "uuid" in s ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") currentSquads.push(u);
    }
    const hasActivePaidSub =
      currentExpireAt != null &&
      currentSquads.length > 0 &&
      !(currentSquads.length === 1 && currentSquads[0] === trialSquadUuid);
    if (hasActivePaidSub) {
      return res.status(400).json({
        message: "Бесплатный тест нельзя активировать — у вас уже есть активная подписка.",
      });
    }

    // Тут была дыра: middleware подсасывает trialUsed=false и кладёт его в req.client.
    // Между проверкой `if (client.trialUsed)` сверху и финальным update'ом флага
    // на самом дне хендлера — сотни мс на Remna API. За это время второй запрос
    // успевает влезть с тем же стейтом и сделать ещё один триал. Юзеры так
    // активировали по 2 триала параллельно (см. отчёт о баге).
    //
    // Фикс — атомик flip на уровне SQL: UPDATE ... WHERE trialUsed = false.
    // PG лочит строку и сериализует — кому повезло, у того count = 1, остальные
    // получают 0 и идут лесом с 409.
    const trialGuardA = await prisma.client.updateMany({
      where: { id: client.id, trialUsed: false },
      data: { trialUsed: true },
    });
    if (trialGuardA.count === 0) {
      return res.status(409).json({ message: "Бесплатный тест уже активирован" });
    }

    const expireAt = calculateExpireAt(currentExpireAt, trialDays);

    const updateRes = await remnaUpdateUser({
      uuid: workingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [trialSquadUuid],
    });
    if (updateRes.error) {
      // Remna кинула — откатываем флаг, пусть юзер ретраит. Иначе мы у него
      // отняли триал, а активации не сделали — на ровном месте обидится.
      await prisma.client.update({ where: { id: client.id }, data: { trialUsed: false } }).catch(() => {});
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }

    // материализуем подписку для триала в ПЕРВЫЙ СВОБОДНЫЙ
    // слот (0, 1, 2…). Если триал переактивируется на том же Remna-юзере — UPDATE, не дубль.
    await upsertSubscriptionByRemnaUuid(client.id, {
      remnawaveUuid: workingUuid,
      // Триал не привязан к конкретному тарифу — tariffId=null.
      // trialId здесь null (триал из system config, не из таблицы Trial).
    }).catch((e) => console.error("[trial] upsertSubscriptionByRemnaUuid failed:", e));
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const displayUsername = remnaUsernameFromClient({
      telegramUsername: client.telegramUsername,
      telegramId: client.telegramId,
      email: client.email,
      clientIdFallback: client.id,
    });
    if (!existingUuid) {
      const byUsernameRes = await remnaGetUserByUsername(displayUsername);
      existingUuid = extractRemnaUuid(byUsernameRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byUsernameRes.data);
    }

    // Та же история, что в ветке выше — флипаем флаг ДО любого побочного
    // эффекта в Remna. Без этого 2 параллельных запроса оба создавали юзера.
    const trialGuardB = await prisma.client.updateMany({
      where: { id: client.id, trialUsed: false },
      data: { trialUsed: true },
    });
    if (trialGuardB.count === 0) {
      return res.status(409).json({ message: "Бесплатный тест уже активирован" });
    }

    const expireAt = calculateExpireAt(currentExpireAt, trialDays);

    if (!existingUuid) {
      const createRes = await remnaCreateUser({
        username: displayUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [trialSquadUuid],
        ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
        ...(client.email?.trim() && { email: client.email.trim() }),
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }

    if (!existingUuid) {
      // Remna create обосрался — откатываем флаг, юзер ретраит.
      await prisma.client.update({ where: { id: client.id }, data: { trialUsed: false } }).catch(() => {});
      return res.status(502).json({ message: "Ошибка создания пользователя" });
    }

    await remnaUpdateUser({
      uuid: existingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [trialSquadUuid],
    });
    workingUuid = existingUuid;
    await prisma.client.update({
      where: { id: client.id },
      data: { remnawaveUuid: existingUuid }, // trialUsed already set by atomic guard
    });

    // подписка для триала в первый свободный слот.
    await upsertSubscriptionByRemnaUuid(client.id, {
      remnawaveUuid: existingUuid,
    }).catch((e) => console.error("[trial] upsertSubscriptionByRemnaUuid failed:", e));

    // уведомление админам в TG-группу: активирован legacy-триал (best-effort).
    import("../notification/telegram-notify.service.js")
      .then((m) => m.notifyAdminsAboutTrialActivated(client.id, "Бесплатный тест", trialDays))
      .catch((e) => console.error("[trial] admin notify failed:", e));

    const updated = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true, passwordHash: true } });
    return res.json({ message: "Бесплатный тест активирован", client: updated ? toClientShape(updated) : null });
  }

  // уведомление админам в TG-группу: активирован legacy-триал (best-effort).
  import("../notification/telegram-notify.service.js")
    .then((m) => m.notifyAdminsAboutTrialActivated(client.id, "Бесплатный тест", trialDays))
    .catch((e) => console.error("[trial] admin notify failed:", e));

  // Финальный update trialUsed убран — атомик guard выше уже всё сделал.
  // Отдельный write был чисто легаси-страховкой.
  const updated = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true, passwordHash: true } });
  return res.json({ message: "Бесплатный тест активирован", client: updated ? toClientShape(updated) : null });
});

/**
 * Список ДОСТУПНЫХ для клиента триалов.
 * Доступный = enabled AND ещё не активированный этим клиентом (нет записи в client_trial_usages).
 *
 * Возвращает массив с tariffName/durationDays/etc для отрисовки кнопок в боте/кабинете.
 * Если массив пустой → клиент использовал ВСЕ триалы (или их вообще нет) → кнопка
 * «Получить пробную» в главном меню скрывается.
 */
export async function fetchAvailableTrialsForClient(clientId: string) {
  const allEnabled = await prisma.trial.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { tariff: { select: { id: true, name: true, trafficLimitBytes: true, deviceLimit: true, includedDevices: true } } },
  });
  // hasAnyEnabled — флаг для бота, чтобы при пустом items.length знать:
  //   нет триалов вообще (используй legacy single-trial flow) или
  //   все использованы (скрывай кнопку «Получить пробную»).
  if (allEnabled.length === 0) return { items: [], hasAnyEnabled: false };
  const used = await prisma.clientTrialUsage.findMany({
    where: { clientId },
    select: { trialId: true },
  });
  const usedSet = new Set(used.map((u) => u.trialId));
  const available = allEnabled.filter((t) => !usedSet.has(t.id));
  return {
    items: available.map((t) => {
      // trafficLimitBytes из триала (если задан) или из тарифа.
      // Отдаём как строку (BigInt JSON-safe). Клиенты конвертят в Number для отображения.
      const effectiveTraffic = t.trafficLimitBytes ?? t.tariff?.trafficLimitBytes ?? null;
      return {
        id: t.id,
        name: t.name,
        price: t.price,
        tariffId: t.tariffId,
        tariffName: t.tariff?.name ?? null,
        durationDays: t.durationDays,
        description: t.description,
        sortOrder: t.sortOrder,
        trafficLimitBytes: effectiveTraffic !== null ? effectiveTraffic.toString() : null,
        deviceLimit: t.deviceLimit ?? t.tariff?.deviceLimit ?? null,
        includedDevices: t.tariff?.includedDevices ?? t.deviceLimit ?? null,
      };
    }),
    hasAnyEnabled: true,
  };
}

clientTrialsPromoRouter.get("/trials/available", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const result = await fetchAvailableTrialsForClient(clientId);
  return res.json(result);
});

/**
 * Активация конкретного триала.
 * Использует createAdditionalSubscription (как для подарков) — создаёт secondary
 * с настройками тарифа триала и длительностью из триала. Помечает её trial_id.
 * Записывает в client_trial_usages для блокировки повторной активации.
 */
clientTrialsPromoRouter.post("/trials/:id/activate", requireRemnaOnline, async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const { activateTrial } = await import("../trial/trial.service.js");
  const result = await activateTrial(clientId, req.params.id, req.body?.expectedPrice);
  return res.status(result.status).json(result.body);
});

// ——— Активация промо-ссылки ———
clientTrialsPromoRouter.post("/promo/activate", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null; telegramUsername?: string | null } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const group = await prisma.promoGroup.findUnique({ where: { code: code.trim() } });
  if (!group || !group.isActive) return res.status(404).json({ message: "Промокод не найден или неактивен" });

  // Раньше было: existing-check + count(maxActivations) + потом Remna API + потом
  // promoActivation.create в самом конце. Между чтением count и create — секунды
  // на Remna. Параллельные /promo/activate от разных юзеров пробивали maxActivations
  // (все видели count<max → все активировали → группа уехала за лимит).
  //
  // Фикс — резервируем активацию атомарно ПЕРЕД Remna, через Serializable
  // транзакцию: count → если ок → create. PG сериализует — лишние конкуренты
  // получат serialization_failure и нашу 400. Существующая activation для того
  // же юзера ловится @@unique(promoGroupId, clientId) → P2002 → 400.
  let activationCreated = false;
  try {
    await prisma.$transaction(async (tx) => {
      // Дубль той же связки (юзер уже активировал этот промокод) — DB словит
      // P2002 на create ниже. Тут — отдельная ранняя проверка ради вменяемого
      // сообщения.
      const existing = await tx.promoActivation.findUnique({
        where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
      });
      if (existing) {
        throw new Error("DUPLICATE_USER_ACTIVATION");
      }
      if (group.maxActivations > 0) {
        const count = await tx.promoActivation.count({ where: { promoGroupId: group.id } });
        if (count >= group.maxActivations) {
          throw new Error("MAX_ACTIVATIONS_EXCEEDED");
        }
      }
      await tx.promoActivation.create({
        data: { promoGroupId: group.id, clientId: client.id },
      });
      activationCreated = true;
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "DUPLICATE_USER_ACTIVATION") {
      return res.status(400).json({ message: "Вы уже активировали этот промокод" });
    }
    if (msg === "MAX_ACTIVATIONS_EXCEEDED") {
      return res.status(400).json({ message: "Лимит активаций промокода исчерпан" });
    }
    // P2002 (уник нарушен), serialization_failure, или что-то ещё — трактуем как
    // конкурент уже занял место.
    if ((e as { code?: string })?.code === "P2002") {
      return res.status(400).json({ message: "Вы уже активировали этот промокод" });
    }
    if ((e as { code?: string })?.code === "P2034") {
      return res.status(409).json({ message: "Слишком много одновременных запросов, попробуйте ещё раз" });
    }
    throw e;
  }

  if (!isRemnaConfigured()) {
    // Откатываем резервацию: Remna не настроен, активацию делать нечем.
    if (activationCreated) {
      await prisma.promoActivation.delete({
        where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
      }).catch(() => {});
    }
    return res.status(503).json({ message: "Сервис временно недоступен" });
  }

  const trafficLimitBytes = Number(group.trafficLimitBytes);
  const hwidDeviceLimit = group.deviceLimit ?? null;

  let promoWorkingUuid = client.remnawaveUuid;

  if (promoWorkingUuid) {
    const checkRes = await remnaGetUser(promoWorkingUuid);
    if (checkRes.error || !checkRes.data) {
      console.warn(`[promo] Remna user ${promoWorkingUuid} not found (status ${checkRes.status}), will re-create`);
      promoWorkingUuid = null;
      await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
    }
  }

  if (promoWorkingUuid) {
    const userRes = await remnaGetUser(promoWorkingUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const expireAt = calculateExpireAt(currentExpireAt, group.durationDays);

    const updateRes = await remnaUpdateUser({
      uuid: promoWorkingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [group.squadUuid],
    });
    if (updateRes.error) {
      if (activationCreated) {
        await prisma.promoActivation.delete({
          where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
        }).catch(() => {});
      }
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const displayUsername = remnaUsernameFromClient({
      telegramUsername: client.telegramUsername,
      telegramId: client.telegramId,
      email: client.email,
      clientIdFallback: client.id,
    });
    const expireAt = calculateExpireAt(currentExpireAt, group.durationDays);
    if (!existingUuid) {
      const createRes = await remnaCreateUser({
        username: displayUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [group.squadUuid],
        ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
        ...(client.email?.trim() && { email: client.email.trim() }),
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }
    if (!existingUuid) {
      if (activationCreated) {
        await prisma.promoActivation.delete({
          where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
        }).catch(() => {});
      }
      return res.status(502).json({ message: "Ошибка создания пользователя VPN" });
    }

    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes, hwidDeviceLimit, activeInternalSquads: [group.squadUuid] });

    await prisma.client.update({
      where: { id: client.id },
      data: { remnawaveUuid: existingUuid },
    });
  }

  // Запись об активации уже создана выше в Serializable-транзакции до Remna —
  // повторный create тут НЕ нужен.

  return res.json({ message: "Промокод активирован! Подписка подключена." });
});

// ——— Промокоды (скидки / бесплатные дни) ———

/** Проверить промокод (для скидки — возвращает данные скидки; для FREE_DAYS — информацию) */
clientTrialsPromoRouter.post("/promo-code/check", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const result = await validatePromoCode(code, client.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  const promo = result.promo;
  if (promo.type === "DISCOUNT") {
    return res.json({
      type: "DISCOUNT",
      discountPercent: promo.discountPercent,
      discountFixed: promo.discountFixed,
      name: promo.name,
    });
  }
  return res.json({
    type: "FREE_DAYS",
    durationDays: promo.durationDays,
    name: promo.name,
  });
});

/** Применить промокод FREE_DAYS — активирует подписку */
clientTrialsPromoRouter.post("/promo-code/activate", async (req, res, next) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const code = req.body?.code;
  if (typeof code !== "string" || !code.trim()) return res.status(400).json({ message: "Промокод не указан" });
  try {
    const activated = await activateFreeDaysPromo(client.id, code);
    import("../notification/telegram-notify.service.js")
      .then((m) => m.notifyAdminsAboutPromoActivated(client.id, activated.code, activated.durationDays))
      .catch((e) => console.error("[promo-code activate] admin notify failed:", e));
    return res.json({ message: `Промокод активирован! Подписка на ${activated.durationDays} дн. подключена.`, subscriptionId: activated.subscriptionId });
  } catch (e) {
    if (e instanceof PromoCodeError) return res.status(e.status).json({ message: e.message });
    return next(e);
  }
});
