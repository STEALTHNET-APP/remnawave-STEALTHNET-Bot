import { TriangleAlert } from "lucide-react";

export function WidgetAvailabilityNotice() {
  return <div role="note" aria-label="Ограничение HTML-виджетов Telegram" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
    <div className="flex items-start gap-2">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="min-w-0 space-y-2">
        <p className="font-medium">Telegram ограничивает отправку HTML-виджетов</p>
        <p className="text-xs leading-relaxed text-muted-foreground">По проверке от 15.11.2026 обычные боты не могут отправлять виджеты даже в личные чаты. При отказе Telegram бот автоматически показывает обычное меню.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">Переключатель и предпросмотр остаются доступны, но не подтверждают, что Telegram разрешает отправку.</p>
        <a className="inline-block text-xs underline underline-offset-4" href="https://github.com/tdlib/telegram-bot-api/issues/947" target="_blank" rel="noopener noreferrer">Подтверждение разработчика Telegram ↗</a>
      </div>
    </div>
  </div>;
}
