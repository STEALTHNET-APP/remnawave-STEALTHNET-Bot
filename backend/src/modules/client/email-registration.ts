/**
 * Чистая логика e-mail регистрации (issue #200), без зависимостей — покрыта тестами.
 *
 * pending_email_registrations.password_hash — NOT NULL, поэтому «пароль не задан»
 * храним как пустую строку и превращаем в null при создании клиента: тогда /me
 * отдаёт hasPassword: false и онбординг показывает шаг «Пароль».
 */
export const NO_PASSWORD_HASH = "";

/** Сколько повторный переход по уже использованной ссылке отвечает «уже подтверждено». */
export const VERIFY_EMAIL_REPLAY_WINDOW_MS = 15 * 60 * 1000;

export type RegisterRoute = "email" | "telegram" | null;

/**
 * Email-регистрация допустима без пароля. Без пароля и с telegramId запрос, как и раньше,
 * идёт telegram-путём (бот так не шлёт, но поведение не меняем).
 */
export function resolveRegisterRoute(data: { email?: string; password?: string; telegramId?: string }): RegisterRoute {
  if (data.email && (data.password || !data.telegramId)) return "email";
  if (data.telegramId) return "telegram";
  return null;
}

export function clientPasswordHashFromPending(pendingHash: string): string | null {
  return pendingHash.trim() ? pendingHash : null;
}

export type VerifyEmailDecision = "invalid" | "expired" | "already_verified" | "create";

/**
 * Если клиент с этим email уже есть — ссылка использована (или email занят): сессию НЕ выдаём,
 * отвечаем «уже подтверждено, войдите». Иначе — обычная проверка срока.
 */
export function decideVerifyEmail(input: { pendingExists: boolean; expired: boolean; clientExists: boolean }): VerifyEmailDecision {
  if (!input.pendingExists) return "invalid";
  if (input.clientExists) return "already_verified";
  if (input.expired) return "expired";
  return "create";
}

/** После успешного подтверждения запись живёт ещё короткое окно (не дольше исходного срока). */
export function consumedPendingExpiry(now: Date, currentExpiry: Date): Date {
  const replayUntil = new Date(now.getTime() + VERIFY_EMAIL_REPLAY_WINDOW_MS);
  return replayUntil < currentExpiry ? replayUntil : currentExpiry;
}

/** Одноразовость ссылки сброса: отпечаток текущего хеша (пустой, если пароля ещё нет). */
export function passwordResetFingerprint(passwordHash: string | null): string {
  return (passwordHash ?? "").slice(-12);
}

/**
 * /set-password без текущего пароля — только если пароля нет. Существующий пароль
 * меняется через /change-password (с текущим) или сброс по письму.
 */
export function canSetPasswordWithoutCurrent(passwordHash: string | null): boolean {
  return !passwordHash?.trim();
}

/**
 * Сброс пароля по письму. Аккаунт с паролем — как раньше. Аккаунт БЕЗ пароля — только если
 * его email подтверждён. Флага в схеме нет; registrationSource === "web" ставят лишь /verify-email
 * (email подтверждён ссылкой) и skipEmailVerification-регистрация (аккаунт создан вокруг этого email
 * самим владельцем ввода). Telegram/Google/Apple-аккаунты, к которым email мог быть привязан
 * без подтверждения (/link-email-direct), сюда не попадают.
 */
export function canResetPassword(client: { passwordHash: string | null; registrationSource: string | null }): boolean {
  if (client.passwordHash?.trim()) return true;
  return client.registrationSource === "web";
}

/** Prisma P2002 именно по уникальному email (а не по другому уникальному полю). */
export function isEmailUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.some((t) => typeof t === "string" && t.includes("email"));
  return typeof target === "string" && target.includes("email");
}
