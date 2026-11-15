import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth";
import { api, type AdminSettings } from "@/lib/api";
import { buildMenuPreview, type MenuScenario } from "@/lib/bot-menu-preview";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WidgetAvailabilityNotice } from "@/components/admin/widget-availability-notice";

export function BotMenuPreview({ settings }: { settings: AdminSettings }) {
  const { state } = useAuth();
  const [scenario, setScenario] = useState<MenuScenario>("active");
  const [section, setSection] = useState<"main" | "profile">("main");
  const [mode, setMode] = useState<"classic" | "widget">(settings.botHtmlBubblesTest ? "widget" : "classic");
  const [page, setPage] = useState(0);
  const [action, setAction] = useState("");
  const catalog = useQuery({
    queryKey: ["bot-menu-preview-catalog", state.accessToken], staleTime: 60000,
    queryFn: async () => {
      const [proxy, singbox, trials] = await Promise.all([api.getPublicProxyTariffs(), api.getPublicSingboxTariffs(), api.getTrials(state.accessToken!)]);
      return { proxy: proxy.items.some(category => category.tariffs.length > 0), singbox: singbox.items.some(category => category.tariffs.length > 0), trials: trials.items.some(trial => trial.enabled) };
    }, enabled: !!state.accessToken,
  });
  const preview = buildMenuPreview(settings, { scenario, section: settings.botGroupCabinet ? section : "main", proxy: catalog.data?.proxy ?? false, singbox: catalog.data?.singbox ?? false, trials: catalog.data?.trials || ((settings.trialDays ?? 0) > 0 && !!settings.trialSquadUuid) });
  const buttons = preview.rows.flat();
  const pages = mode === "widget" ? Math.max(preview.widgetPages.length, Math.ceil(buttons.length / 6), 1) : 1;
  const current = Math.min(page, pages - 1);
  const rows = mode === "widget" ? [buttons.slice(Math.min(current, Math.max(0, Math.ceil(buttons.length / 6) - 1)) * 6, Math.min(current, Math.max(0, Math.ceil(buttons.length / 6) - 1)) * 6 + 6)] : preview.rows;
  useEffect(() => { setPage(0); setAction(""); }, [scenario, section, mode]);
  return <aside className="order-first min-w-0 space-y-3 2xl:order-last 2xl:sticky 2xl:top-4" aria-label="Предпросмотр меню бота">
    <div><h3 className="font-semibold">Так увидит клиент</h3><p className="text-xs text-muted-foreground mt-1">Черновик меню. Данные подписки вымышлены, изменения ещё не сохранены.</p></div>
    <div className="grid grid-cols-2 gap-2">
      <div><Label htmlFor="preview-scenario" className="text-xs">Состояние клиента</Label><select id="preview-scenario" value={scenario} onChange={event => setScenario(event.target.value as MenuScenario)} className="mt-1 w-full rounded-md border bg-background p-2 text-xs"><option value="new">Новый клиент</option><option value="active">Активная подписка</option><option value="expired">Подписка истекла</option><option value="trial-used">Триал использован</option></select></div>
      <div><Label htmlFor="preview-mode" className="text-xs">Вид меню</Label><select id="preview-mode" value={mode} onChange={event => setMode(event.target.value as "classic" | "widget")} className="mt-1 w-full rounded-md border bg-background p-2 text-xs"><option value="classic">Обычное</option><option value="widget">HTML-виджет</option></select></div>
    </div>
    {mode === "widget" && <WidgetAvailabilityNotice />}
    {settings.botGroupCabinet && <div className="flex gap-2"><Button type="button" size="sm" variant={section === "main" ? "secondary" : "ghost"} onClick={() => setSection("main")}>Главное меню</Button><Button type="button" size="sm" variant={section === "profile" ? "secondary" : "ghost"} onClick={() => setSection("profile")}>Профиль</Button></div>}
    {catalog.isError && <p className="text-xs text-amber-600">Не удалось проверить каталог услуг. Прокси, доступы и отдельные триалы могут не отображаться. <button type="button" className="underline" onClick={() => void catalog.refetch()}>Повторить</button></p>}
    <div className="rounded-2xl border bg-muted/30 p-3">
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">{settings.serviceName || "STEALTHNET"}</p>
        {mode === "classic" ? <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{preview.text}</p> : <div className="text-sm [&_h2]:text-lg [&_h2]:font-semibold [&_.balance]:flex [&_.balance]:justify-between [&_.balance]:mb-3 [&_.balance_strong]:text-xl [&_.row]:flex [&_.row]:justify-between [&_.row]:gap-3 [&_.row]:py-1 [&_.label]:text-muted-foreground [&_.label]:text-xs [&_.value]:text-right [&_.status]:text-muted-foreground [&_.account]:text-xs [&_.account]:mt-3 [&_.account]:text-muted-foreground [&_.prose]:whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: preview.widgetPages[Math.min(current, preview.widgetPages.length - 1)] }} />}
        <div className="mt-4 space-y-2">{rows.map((row, index) => <div key={index} className={mode === "widget" ? "grid grid-cols-2 gap-2" : "flex gap-2"}>{row.map((button, buttonIndex) => <button type="button" key={buttonIndex} className={`min-w-0 flex-1 rounded-lg px-2 py-2.5 text-xs font-medium break-words transition-colors ${mode === "widget" ? buttonIndex === 0 ? "bg-blue-500 text-white" : "bg-muted" : button.style === "primary" ? "bg-blue-500/15 text-blue-500" : button.style === "success" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : button.style === "danger" ? "bg-red-500/15 text-red-500" : "bg-muted"}`} onClick={() => {
          if ("callback_data" in button && button.callback_data === "menu:profile" && settings.botGroupCabinet) setSection("profile");
          else setAction(`«${button.text.trim()}»: ${"web_app" in button ? "откроется Mini App" : "url" in button ? "откроется ссылка" : "откроется раздел бота"}`);
        }}>{button.text}</button>)}</div>)}</div>
        {mode === "widget" && pages > 1 && <div className="mt-3 flex items-center justify-between"><Button type="button" variant="ghost" size="sm" aria-label="Предыдущая страница" disabled={current === 0} onClick={() => setPage(current - 1)}>←</Button><span className="text-xs text-muted-foreground">{current + 1} / {pages}</span><Button type="button" variant="ghost" size="sm" aria-label="Следующая страница" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>→</Button></div>}
        {buttons.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Для этого состояния нет видимых кнопок.</p>}
      </div>
    </div>
    {action && <p role="status" className="text-xs text-muted-foreground">{action}. В предпросмотре действие не выполняется.</p>}
    <p className="text-xs text-muted-foreground">Цвета и premium-эмодзи могут выглядеть иначе в разных клиентах Telegram. {mode === "widget" && !settings.botHtmlBubblesTest ? "HTML-виджеты сейчас выключены в настройках." : ""}</p>
  </aside>;
}
