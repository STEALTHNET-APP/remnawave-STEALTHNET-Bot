export type TitleEmojiEntity = { type: "custom_emoji"; offset: number; length: number; custom_emoji_id: string };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Shared prefix for plain titles and titles containing emoji placeholders. */
export function titleEmojiPrefix(
  key: string,
  emojis: Record<string, { unicode?: string; tgEmojiId?: string }> | null | undefined,
  defaults: Record<string, string>,
): { text: string; entities: TitleEmojiEntity[] } {
  const entry = emojis?.[key];
  // Telegram requires a regular emoji beneath a custom_emoji entity.
  const text = entry?.unicode?.trim() || defaults[key] || (entry?.tgEmojiId ? "🙂" : "•");
  const entities: TitleEmojiEntity[] = [];
  if (entry?.tgEmojiId) {
    const length = graphemes.segment(text)[Symbol.iterator]().next().value?.segment.length ?? 0;
    entities.push({ type: "custom_emoji", offset: 0, length, custom_emoji_id: entry.tgEmojiId });
  }
  return { text, entities };
}
