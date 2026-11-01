import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminSettings } from "@/lib/api";
const defaults = [
  { command: "start", description: "Главное меню", visible: true },
  { command: "subscriptions", description: "Моя подписка / инструкции", visible: true },
  { command: "referral", description: "Реферальная программа", visible: true },
  { command: "support", description: "Поддержка", visible: true },
  { command: "paysupport", description: "Помощь с оплатой Stars", visible: true },
  { command: "autopay", description: "Автоплатежи: просмотр и отмена", visible: true },
];
export function BotCommandsSettings({ value, onChange }: { value: AdminSettings["botCommands"]; onChange: (value: NonNullable<AdminSettings["botCommands"]>) => void }) {
  const commands = value ?? defaults;
  function move(index: number, offset: number) { const next = [...commands]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); }
  return <section className="rounded-xl border p-4 space-y-4">
    <div><h3 className="font-semibold">Команды в меню Telegram</h3><p className="text-sm text-muted-foreground mt-1">Пункты кнопки «Меню» рядом со строкой сообщения. Изменения применяются после сохранения в течение минуты. Скрытую команду всё ещё можно ввести вручную.</p></div>
    {commands.map((item, index) => <div key={item.command} className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 w-36"><input type="checkbox" checked={item.visible} onChange={e => onChange(commands.map((c, i) => i === index ? { ...c, visible: e.target.checked } : c))}/><code className="text-sm">/{item.command}</code></label>
      <Input className="min-w-40 flex-1" aria-label={`Описание /${item.command}`} maxLength={256} value={item.description} onChange={e => onChange(commands.map((c, i) => i === index ? { ...c, description: e.target.value } : c))}/>
      <Button type="button" variant="outline" size="sm" aria-label={`Поднять /${item.command}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</Button><Button type="button" variant="outline" size="sm" aria-label={`Опустить /${item.command}`} disabled={index === commands.length - 1} onClick={() => move(index, 1)}>↓</Button>
    </div>)}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => onChange(commands.map(c => ({ ...c, visible: false })))}>Скрыть все команды</Button><Button type="button" variant="outline" onClick={() => onChange(defaults)}>Вернуть стандартные</Button></div>
    <p className="text-sm text-muted-foreground">Кнопки внутри сообщений настраиваются отдельно ниже. В названии платного триала можно использовать {"{days}"} и {"{amount}"}.</p>
  </section>;
}
