/**
 * STEALTHNET 3.3.4+ — Landing Editor service.
 *
 * Блочный редактор лендинга с draft-режимом и снапшотами.
 * Public render — `props` + `i18n` (опубликованные данные).
 * Edit-mode — `propsDraft ?? props`, `i18nDraft ?? i18n`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { getBlockDefaults, mergeDefaults, isBlockEmpty } from "./landing.defaults.js";

const BLOCK_ORDER_STEP = 10;
// Reserved editor metadata stays in the existing JSON draft column. Published
// props never contain it; no destructive schema migration is required.
const EDITOR_KEY = "__landingEditor";
const record = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
function meta(b: { propsDraft: unknown }) { return record(record(b.propsDraft)[EDITOR_KEY]); }
function clean(v: unknown) { const { [EDITOR_KEY]: _internal, ...rest } = record(v); return rest; }
function effective<T extends { propsDraft: unknown; visible: boolean; variant: string; order: number }>(b: T): T {
  const m = meta(b);
  return { ...b, visible: typeof m.visible === "boolean" ? m.visible : b.visible,
    variant: typeof m.variant === "string" ? m.variant : b.variant,
    order: typeof m.order === "number" ? m.order : b.order };
}
function publishData(b: any) {
  const e = effective(b);
  return { visible: e.visible, variant: e.variant, order: e.order,
    props: clean(b.propsDraft ?? b.props) as Prisma.InputJsonValue,
    i18n: (b.i18nDraft ?? b.i18n) as Prisma.InputJsonValue,
    propsDraft: Prisma.DbNull, i18nDraft: Prisma.DbNull };
}

const SUPPORTED_LANGS = ["ru", "en"] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

function pickLocalized(i18n: unknown, lang: Lang): Record<string, unknown> {
  if (!i18n || typeof i18n !== "object") return {};
  const map = i18n as Record<string, unknown>;
  const exact = map[lang];
  if (exact && typeof exact === "object") return exact as Record<string, unknown>;
  const fallback = map.ru ?? map.en;
  if (fallback && typeof fallback === "object") return fallback as Record<string, unknown>;
  return {};
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

export async function listBlocks(opts: { withDraft?: boolean } = {}) {
  const blocks = await prisma.landingBlock.findMany({ orderBy: { order: "asc" } });
  if (opts.withDraft) return blocks.filter(b => !meta(b).deleted).map(effective).sort((a, b) => a.order - b.order);
  // Public mode: убираем draft-поля, отдаём только опубликованные.
  return blocks.map((b) => ({
    id: b.id,
    type: b.type,
    variant: b.variant,
    order: b.order,
    visible: b.visible,
    props: b.props,
    i18n: b.i18n,
  }));
}

export async function listBlocksForRender(lang: Lang, opts: { useDraft?: boolean } = {}) {
  const blocks = await prisma.landingBlock.findMany({ orderBy: { order: "asc" } });
  return blocks.filter(b => opts.useDraft ? !meta(b).deleted && effective(b).visible : b.visible)
    .map(b => ({ id: b.id, type: b.type,
      variant: opts.useDraft ? effective(b).variant : b.variant,
      order: opts.useDraft ? effective(b).order : b.order,
      props: clean(opts.useDraft ? b.propsDraft ?? b.props : b.props),
      text: pickLocalized(opts.useDraft ? b.i18nDraft ?? b.i18n : b.i18n, lang),
    })).sort((a,b) => a.order - b.order);
}

export async function getBlock(id: string) {
  const block = await prisma.landingBlock.findUnique({ where: { id } });
  return block ? effective(block) : null;
}

export async function createBlock(input: {
  type: string;
  variant?: string;
  props?: unknown;
  i18n?: unknown;
  order?: number;
  visible?: boolean;
}) {
  const list = await listBlocks({ withDraft: true });
  const order = input.order ?? Math.max(0, ...list.map(b => b.order)) + BLOCK_ORDER_STEP;
  const defaults = getBlockDefaults(input.type, input.variant ?? "default");
  return prisma.landingBlock.create({
    data: {
      type: input.type,
      variant: input.variant ?? "default",
      order,
      visible: false,
      props: {}, i18n: {},
      propsDraft: { ...clean(input.props ?? defaults.props), [EDITOR_KEY]: { isNew: true, visible: input.visible ?? true } },
      i18nDraft: (input.i18n ?? defaults.i18n ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Обновление блока: меняем `*Draft`-поля. Основные `props` / `i18n` остаются нетронутыми
 * до Publish. Структурные настройки сохраняются в зарезервированной части propsDraft.
 */
export async function updateBlockDraft(
  id: string,
  input: {
    propsDraft?: unknown;
    i18nDraft?: unknown;
    visible?: boolean;
    variant?: string;
    order?: number;
  },
) {
  return prisma.$transaction(async tx => {
    const block = await tx.landingBlock.findUniqueOrThrow({ where: { id } });
    const structure = { ...meta(block) };
    if (input.visible !== undefined) structure.visible = input.visible;
    if (input.variant !== undefined) structure.variant = input.variant;
    if (input.order !== undefined) structure.order = input.order;
    const data: Prisma.LandingBlockUpdateInput = {};
    if (input.propsDraft !== undefined || input.visible !== undefined || input.variant !== undefined || input.order !== undefined) {
      data.propsDraft = { ...clean(input.propsDraft ?? block.propsDraft ?? block.props), [EDITOR_KEY]: structure };
    }
    if (input.i18nDraft !== undefined) data.i18nDraft = input.i18nDraft === null ? Prisma.DbNull : input.i18nDraft as Prisma.InputJsonValue;
    return effective(await tx.landingBlock.update({ where: { id }, data }));
  });
}

export async function publishBlock(id: string) {
  return prisma.$transaction(async tx => {
    const block = await tx.landingBlock.findUniqueOrThrow({ where: { id } });
    if (meta(block).deleted) return tx.landingBlock.delete({ where: { id } });
    return tx.landingBlock.update({ where: { id }, data: publishData(block) });
  });
}

export async function discardBlockDraft(id: string) {
  return prisma.$transaction(async tx => {
    const block = await tx.landingBlock.findUniqueOrThrow({ where: { id } });
    if (meta(block).isNew) return tx.landingBlock.delete({ where: { id } });
    return tx.landingBlock.update({ where: { id }, data: { propsDraft: Prisma.DbNull, i18nDraft: Prisma.DbNull } });
  });
}

export async function deleteBlock(id: string) {
  return prisma.$transaction(async tx => {
    const block = await tx.landingBlock.findUniqueOrThrow({ where: { id } });
    if (meta(block).isNew) return tx.landingBlock.delete({ where: { id } });
    return tx.landingBlock.update({ where: { id }, data: {
      propsDraft: { ...clean(block.propsDraft ?? block.props), [EDITOR_KEY]: { ...meta(block), deleted: true } },
    } });
  });
}

export async function reorderBlocks(items: { id: string; order: number }[]) {
  await prisma.$transaction(async tx => {
    for (const it of items) {
      const b = await tx.landingBlock.findUniqueOrThrow({ where: { id: it.id } });
      await tx.landingBlock.update({ where: { id: it.id }, data: {
        propsDraft: { ...clean(b.propsDraft ?? b.props), [EDITOR_KEY]: { ...meta(b), order: it.order } },
      } });
    }
  });
  return listBlocks({ withDraft: true });
}

// ─── Theme ───────────────────────────────────────────────────────────────────

const DEFAULT_FONT_PRESETS = [
  { name: "Inter", url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" },
  { name: "Manrope", url: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" },
  { name: "Onest", url: "https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800;900&display=swap" },
  { name: "Space Grotesk", url: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" },
  { name: "IBM Plex Sans", url: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" },
  { name: "Geist", url: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&display=swap" },
  { name: "Plus Jakarta Sans", url: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" },
  { name: "JetBrains Mono", url: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" },
] as const;

export async function ensureTheme() {
  const existing = await prisma.landingTheme.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.landingTheme.create({
    data: {
      id: "default",
      fontFamily: "Manrope",
      primaryColor: "#a3a2ff", backgroundColor: "#080c16", textColor: "#edf0fa", accentColor: "#6ed7e7", borderRadius: "16px", containerWidth: "1360px",
      fontPresets: DEFAULT_FONT_PRESETS as unknown as object,
    },
  });
}

export async function getTheme(opts: { withDraft?: boolean } = {}) {
  const theme = await ensureTheme();
  if (!opts.withDraft && theme.draft) {
    // Public: отдаём только опубликованные значения.
    const { draft, ...rest } = theme;
    void draft;
    return rest;
  }
  return theme;
}

export async function getThemeForRender(opts: { useDraft?: boolean } = {}) {
  const theme = await ensureTheme();
  const draft = opts.useDraft && theme.draft ? (theme.draft as Record<string, unknown>) : null;
  const pick = <T,>(key: string, fallback: T): T => {
    if (draft && draft[key] !== undefined) return draft[key] as T;
    return fallback;
  };
  return {
    primaryColor: pick("primaryColor", theme.primaryColor),
    accentColor: pick("accentColor", theme.accentColor),
    backgroundColor: pick("backgroundColor", theme.backgroundColor),
    textColor: pick("textColor", theme.textColor),
    fontFamily: pick("fontFamily", theme.fontFamily),
    borderRadius: pick("borderRadius", theme.borderRadius),
    containerWidth: pick("containerWidth", theme.containerWidth),
    customCss: pick("customCss", theme.customCss),
    fontPresets: theme.fontPresets,
  };
}

export async function updateThemeDraft(input: { draft: unknown }) {
  await ensureTheme();
  return prisma.landingTheme.update({
    where: { id: "default" },
    data: { draft: input.draft === null ? Prisma.DbNull : (input.draft as Prisma.InputJsonValue) },
  });
}

export async function publishTheme() {
  const theme = await ensureTheme();
  if (!theme.draft) return theme;
  const draft = theme.draft as Record<string, unknown>;
  return prisma.landingTheme.update({
    where: { id: "default" },
    data: {
      primaryColor: draft.primaryColor === null ? null : typeof draft.primaryColor === "string" ? draft.primaryColor : theme.primaryColor,
      accentColor: draft.accentColor === null ? null : typeof draft.accentColor === "string" ? draft.accentColor : theme.accentColor,
      backgroundColor: draft.backgroundColor === null ? null : typeof draft.backgroundColor === "string" ? draft.backgroundColor : theme.backgroundColor,
      textColor: draft.textColor === null ? null : typeof draft.textColor === "string" ? draft.textColor : theme.textColor,
      fontFamily: draft.fontFamily === null ? null : typeof draft.fontFamily === "string" ? draft.fontFamily : theme.fontFamily,
      borderRadius: draft.borderRadius === null ? null : typeof draft.borderRadius === "string" ? draft.borderRadius : theme.borderRadius,
      containerWidth: draft.containerWidth === null ? null : typeof draft.containerWidth === "string" ? draft.containerWidth : theme.containerWidth,
      customCss: draft.customCss === null ? null : typeof draft.customCss === "string" ? draft.customCss : theme.customCss,
      fontPresets: (Array.isArray(draft.fontPresets) ? draft.fontPresets : theme.fontPresets) as Prisma.InputJsonValue,
      draft: Prisma.DbNull,
    },
  });
}

export async function discardThemeDraft() {
  return prisma.landingTheme.update({ where: { id: "default" }, data: { draft: Prisma.DbNull } });
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

export async function createSnapshot(opts: { label?: string; createdBy?: string } = {}) {
  const blocks = await prisma.landingBlock.findMany({ orderBy: { order: "asc" } });
  const theme = await ensureTheme();
  return prisma.landingSnapshot.create({
    data: {
      label: opts.label ?? "manual",
      createdBy: opts.createdBy ?? null,
      data: { blocks, theme } as unknown as object,
    },
  });
}

export async function listSnapshots(limit = 50) {
  const items = await prisma.landingSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, label: true, createdBy: true, createdAt: true },
  });
  return items;
}

export async function getSnapshot(id: string) {
  return prisma.landingSnapshot.findUnique({ where: { id } });
}

export async function deleteSnapshot(id: string) {
  return prisma.landingSnapshot.delete({ where: { id } });
}

/**
 * Восстановление: текущее состояние сначала сохраняется как auto-snapshot
 * ("auto-before-restore"), затем БД заменяется содержимым выбранного снапшота.
 */
export async function restoreSnapshot(id: string, createdBy?: string) {
  const snap = await prisma.landingSnapshot.findUnique({ where: { id } });
  if (!snap) throw new Error("Snapshot not found");
  await createSnapshot({ label: "auto-before-restore", createdBy });

  const data = snap.data as { blocks?: unknown[]; theme?: unknown };
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const theme = (data.theme ?? null) as Record<string, unknown> | null;

  await prisma.$transaction(async (tx) => {
    await tx.landingBlock.deleteMany({});
    for (const raw of blocks) {
      const b = raw as Record<string, unknown>;
      await tx.landingBlock.create({
        data: {
          id: typeof b.id === "string" ? b.id : undefined,
          type: String(b.type ?? "custom"),
          variant: String(b.variant ?? "default"),
          order: Number(b.order ?? 0),
          visible: Boolean(b.visible ?? true),
          props: (b.props as object) ?? {},
          i18n: (b.i18n as object) ?? {},
          propsDraft: (b.propsDraft as object) ?? undefined,
          i18nDraft: (b.i18nDraft as object) ?? undefined,
        },
      });
    }
    if (theme) {
      await tx.landingTheme.upsert({
        where: { id: "default" },
        update: {
          primaryColor: typeof theme.primaryColor === "string" ? theme.primaryColor : null,
          accentColor: typeof theme.accentColor === "string" ? theme.accentColor : null,
          backgroundColor: typeof theme.backgroundColor === "string" ? theme.backgroundColor : null,
          textColor: typeof theme.textColor === "string" ? theme.textColor : null,
          fontFamily: typeof theme.fontFamily === "string" ? theme.fontFamily : null,
          fontPresets: Array.isArray(theme.fontPresets) ? (theme.fontPresets as object) : [],
          borderRadius: typeof theme.borderRadius === "string" ? theme.borderRadius : null,
          containerWidth: typeof theme.containerWidth === "string" ? theme.containerWidth : null,
          customCss: typeof theme.customCss === "string" ? theme.customCss : null,
          draft: Prisma.DbNull,
        },
        create: {
          id: "default",
          primaryColor: typeof theme.primaryColor === "string" ? theme.primaryColor : null,
          accentColor: typeof theme.accentColor === "string" ? theme.accentColor : null,
          fontFamily: typeof theme.fontFamily === "string" ? theme.fontFamily : "Inter",
          fontPresets: Array.isArray(theme.fontPresets) ? (theme.fontPresets as object) : [],
        },
      });
    }
  });

  return { restored: true, blocksCount: blocks.length };
}

/**
 * Атомарный публиш всего: создаёт auto-snapshot "auto-before-publish",
 * затем переносит все *Draft → main и для блоков, и для темы.
 */
export async function publishAll(createdBy?: string) {
  await createSnapshot({ label: "auto-before-publish", createdBy });

  const blocks = await prisma.landingBlock.findMany({
    where: { OR: [{ propsDraft: { not: Prisma.DbNull } }, { i18nDraft: { not: Prisma.DbNull } }] },
  });
  const theme = await ensureTheme();

  await prisma.$transaction(async (tx) => {
    for (const b of blocks) {
      if (meta(b).deleted) await tx.landingBlock.delete({ where: { id: b.id } });
      else await tx.landingBlock.update({ where: { id: b.id }, data: publishData(b) });
    }
    if (theme.draft) {
      const draft = theme.draft as Record<string, unknown>;
      await tx.landingTheme.update({
        where: { id: "default" },
        data: {
          primaryColor: draft.primaryColor === null ? null : typeof draft.primaryColor === "string" ? draft.primaryColor : theme.primaryColor,
          accentColor: draft.accentColor === null ? null : typeof draft.accentColor === "string" ? draft.accentColor : theme.accentColor,
          backgroundColor: draft.backgroundColor === null ? null : typeof draft.backgroundColor === "string" ? draft.backgroundColor : theme.backgroundColor,
          textColor: draft.textColor === null ? null : typeof draft.textColor === "string" ? draft.textColor : theme.textColor,
          fontFamily: draft.fontFamily === null ? null : typeof draft.fontFamily === "string" ? draft.fontFamily : theme.fontFamily,
          borderRadius: draft.borderRadius === null ? null : typeof draft.borderRadius === "string" ? draft.borderRadius : theme.borderRadius,
          containerWidth: draft.containerWidth === null ? null : typeof draft.containerWidth === "string" ? draft.containerWidth : theme.containerWidth,
          customCss: draft.customCss === null ? null : typeof draft.customCss === "string" ? draft.customCss : theme.customCss,
          fontPresets: (Array.isArray(draft.fontPresets) ? draft.fontPresets : theme.fontPresets) as Prisma.InputJsonValue,
          draft: Prisma.DbNull,
        },
      });
    }
  });

  return { publishedBlocks: blocks.length, themePublished: !!theme.draft };
}

export async function discardAllDrafts() {
  await prisma.$transaction(async tx => {
    const blocks = await tx.landingBlock.findMany();
    for (const b of blocks) {
      if (meta(b).isNew) await tx.landingBlock.delete({ where: { id: b.id } });
      else if (b.propsDraft || b.i18nDraft) await tx.landingBlock.update({ where: { id: b.id }, data: { propsDraft: Prisma.DbNull, i18nDraft: Prisma.DbNull } });
    }
    await tx.landingTheme.updateMany({ where: { id: "default" }, data: { draft: Prisma.DbNull } });
  });
  return { discarded: true };
}

// ─── Defaults (стандартные значения блоков) ─────────────────────────────────

/**
 * Применяет канонические дефолты в `propsDraft` / `i18nDraft` выбранного блока.
 * Если `mode = "merge"` — не перетирает уже заполненные поля. Если `mode = "overwrite"` —
 * полностью заменяет содержимое draft.
 */
export async function applyBlockDefaults(id: string, mode: "merge" | "overwrite" = "merge") {
  const block = await prisma.landingBlock.findUnique({ where: { id } });
  if (!block) throw new Error("Block not found");
  const defaults = getBlockDefaults(block.type, effective(block).variant);

  if (mode === "overwrite") {
    return prisma.landingBlock.update({
      where: { id },
      data: {
        propsDraft: { ...clean(defaults.props), [EDITOR_KEY]: meta(block) },
        i18nDraft: (defaults.i18n ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  // merge: берём draft если есть, иначе main, и доливаем дефолты в пустые поля.
  const currentProps = (block.propsDraft ?? block.props ?? {}) as Record<string, unknown>;
  const currentI18n = (block.i18nDraft ?? block.i18n ?? {}) as Record<string, unknown>;
  const merged = mergeDefaults({ props: currentProps, i18n: currentI18n }, defaults);

  return prisma.landingBlock.update({
    where: { id },
    data: {
      propsDraft: merged.props as Prisma.InputJsonValue,
      i18nDraft: merged.i18n as Prisma.InputJsonValue,
    },
  });
}

/**
 * Заливает дефолты в любые блоки с **частично или полностью пустым** контентом.
 * Использует mergeDefaults — заполняет пустые поля, не трогая уже введённый текст.
 * Пишет в main (props/i18n), не в draft — чтобы и live-превью, и форма редактора
 * сразу показывали стандартные значения без необходимости публиковать.
 *
 * Идемпотентно: если merged-результат идентичен существующему, БД не обновляется.
 */
export async function seedDefaultsToEmptyBlocks(): Promise<{ filled: number; total: number }> {
  const blocks = await prisma.landingBlock.findMany();
  let filled = 0;
  for (const b of blocks) {
    const defaults = getBlockDefaults(b.type, b.variant);
    if (!defaults.props && !defaults.i18n) continue;

    const existingProps = (b.props ?? {}) as Record<string, unknown>;
    const existingI18n = (b.i18n ?? {}) as Record<string, unknown>;
    const merged = mergeDefaults({ props: existingProps, i18n: existingI18n }, defaults);

    // Если ничего не изменилось — пропускаем (избегаем лишних DB-write).
    if (
      JSON.stringify(merged.props) === JSON.stringify(existingProps) &&
      JSON.stringify(merged.i18n) === JSON.stringify(existingI18n)
    ) continue;

    await prisma.landingBlock.update({
      where: { id: b.id },
      data: {
        props: merged.props as Prisma.InputJsonValue,
        i18n: merged.i18n as Prisma.InputJsonValue,
      },
    });
    filled++;
  }
  return { filled, total: blocks.length };
}

// isBlockEmpty оставлен в landing.defaults как утилита, но в seed мы его больше не используем —
// merge сам решает что заполнить.
void isBlockEmpty;

// ─── Landing on/off toggle (хранится в system_settings.landing_enabled) ─────

export async function getLandingEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "landing_enabled" } });
  if (!row) return false;
  return row.value === "true" || row.value === "1";
}

export async function setLandingEnabled(value: boolean): Promise<{ enabled: boolean }> {
  await prisma.systemSetting.upsert({
    where: { key: "landing_enabled" },
    update: { value: value ? "true" : "false" },
    create: { key: "landing_enabled", value: value ? "true" : "false" },
  });
  return { enabled: value };
}

export async function hasPendingDrafts() {
  const block = await prisma.landingBlock.findFirst({
    where: { OR: [{ propsDraft: { not: Prisma.DbNull } }, { i18nDraft: { not: Prisma.DbNull } }] },
    select: { id: true },
  });
  const theme = await prisma.landingTheme.findUnique({ where: { id: "default" }, select: { draft: true } });
  return { hasBlockDrafts: !!block, hasThemeDraft: !!theme?.draft };
}

