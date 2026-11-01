type Command = { command: string; description: string; visible: boolean };
export const defaultBotCommands: Command[] = [
  { command: "start", description: "Главное меню", visible: true },
  { command: "subscriptions", description: "Моя подписка / инструкции", visible: true },
  { command: "referral", description: "Реферальная программа", visible: true },
  { command: "support", description: "Поддержка", visible: true },
  { command: "paysupport", description: "Помощь с оплатой Stars", visible: true },
  { command: "autopay", description: "Автоплатежи: просмотр и отмена", visible: true },
];
export function createCommandSync(set: (commands: { command: string; description: string }[], options: { scope: { type: "default" | "all_private_chats" }; language_code?: "ru" | "en" }) => Promise<unknown>) {
  let applied = "";
  let pending: Promise<void> | null = null;
  return async (config?: Command[]) => {
    if (pending) return pending;
    const commands = (config ?? defaultBotCommands).filter(c => c.visible).map(({ command, description }) => ({ command, description }));
    const fingerprint = JSON.stringify(commands);
    if (fingerprint === applied) return;
    pending = (async () => {
      for (const type of ["default", "all_private_chats"] as const) {
        for (const language_code of [undefined, "ru", "en"] as const) await set(commands, { scope: { type }, language_code });
      }
      applied = fingerprint;
    })();
    try { await pending; } finally { pending = null; }
  };
}
