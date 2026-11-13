import assert from "node:assert/strict";
import test from "node:test";
import { titleEmojiPrefix } from "./title-emoji.js";

test("an ID-only custom emoji wraps a valid emoji, never a bullet", () => {
  const result = titleEmojiPrefix("DEVICES", { DEVICES: { tgEmojiId: "123" } }, {});
  const entity = result.entities[0];
  assert.equal(entity.custom_emoji_id, "123");
  const covered = result.text.slice(entity.offset, entity.offset + entity.length);
  assert.match(covered, /^\p{Extended_Pictographic}/u);
  assert.equal(covered, result.text);
});

test("custom emoji span covers the whole configured emoji in UTF-16", () => {
  for (const unicode of ["📱", "◀️", "👩‍💻", "🇯🇵"]) {
    const result = titleEmojiPrefix("CUSTOM", { CUSTOM: { unicode, tgEmojiId: "123" } }, {});
    assert.equal(result.text, unicode);
    assert.equal(result.entities[0].length, unicode.length);
  }
});

test("plain titles retain their configured or default glyph without entities", () => {
  assert.deepEqual(titleEmojiPrefix("DEVICES", {}, { DEVICES: "📱" }), { text: "📱", entities: [] });
  assert.deepEqual(titleEmojiPrefix("UNKNOWN", {}, {}), { text: "•", entities: [] });
});

test("configured text after an emoji is not included in the custom entity", () => {
  const result = titleEmojiPrefix("DEVICES", { DEVICES: { unicode: "📱 VPN", tgEmojiId: "123" } }, {});
  assert.equal(result.text, "📱 VPN");
  assert.equal(result.entities[0].length, "📱".length);
});
