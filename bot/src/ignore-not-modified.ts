import type { Transformer } from "grammy";

const EDIT_METHODS: ReadonlySet<string> = new Set([
  "editMessageText",
  "editMessageCaption",
  "editMessageReplyMarkup",
  "editMessageMedia",
]);

const NOT_MODIFIED_RE = /message is not modified/i;

/**
 * API-трансформер grammY: Telegram отвечает 400 "message is not modified", когда
 * правка ничего не меняет (например, двойное нажатие кнопки). Это не ошибка —
 * превращаем такой ответ в успешный (`true`, как у edit-методов для inline-сообщений),
 * чтобы не бросалось исключение и не засорялись логи.
 */
export const ignoreNotModified: Transformer = async (prev, method, payload, signal) => {
  const res = await prev(method, payload, signal);
  if (
    !res.ok &&
    res.error_code === 400 &&
    EDIT_METHODS.has(method) &&
    NOT_MODIFIED_RE.test(res.description)
  ) {
    return { ok: true, result: true } as unknown as typeof res;
  }
  return res;
};
