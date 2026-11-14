export function syncFailureSummary(stage: string, errors: string[]) {
  const details = errors.slice(0, 5).map((error) => {
    const prismaCode = error.match(/\bP\d{4}\b/)?.[0];
    if (/Unique constraint failed/i.test(error)) return "Конфликт уникальных данных клиента или подписки (P2002). Проверьте повторяющиеся Telegram ID, email и Remna ID.";
    if (prismaCode) return `Ошибка базы данных ${prismaCode}.`;
    return error
      .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s]+/gi, "[адрес скрыт]")
      .replace(/(?:bearer\s+|(?:token|password|secret|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "[секрет скрыт]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email скрыт]")
      .replace(/\s+/g, " ").slice(0, 300);
  });
  return { stage, errorCount: errors.length, errors: details, message: `${stage}: ${errors.length} ошибок. ${details.join("; ")}` };
}
