import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { useInvalidateClientData } from "@/lib/queries";
import { PromoCodeForm } from "@/components/cabinet/promo-code-form";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { Button } from "@/components/ui/button";
import { ClassicProfilePage } from "./client-profile";

function Devices() {
  const { state } = useClientAuth();
  const token = state.token!;
  const query = useQuery({ queryKey: ["bot-menu", "devices", token], queryFn: () => api.getMyAllDevices(token) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const invalidate = useInvalidateClientData();
  async function remove(device: NonNullable<typeof query.data>["items"][number]) {
    if (lock.current || !window.confirm("Отключить это устройство от подписки?")) return;
    lock.current = true;
    setBusy(`${device.subscriptionId}:${device.hwid}`);
    setError("");
    try {
      await api.deleteClientDevice(token, device.hwid, { type: device.subscriptionType, id: device.subscriptionId });
      invalidate();
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отключить устройство");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  return <div className="space-y-3">
    {query.isLoading && <p>Загружаем устройства…</p>}
    {(query.error || error) && <p role="alert">{error || (query.error instanceof Error ? query.error.message : "Не удалось загрузить устройства")}</p>}
    {query.data?.items.length === 0 && <p>Подключённых устройств пока нет.</p>}
    {query.data?.items.map(d => <div key={`${d.subscriptionId}:${d.hwid}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
      <div><p className="font-medium">{[d.platform, d.deviceModel].filter(Boolean).join(" · ") || "Устройство"}</p><p className="text-sm text-muted-foreground">{d.tariffName || `Подписка #${d.subscriptionIndex}`}{d.appName ? ` · ${d.appName}` : ""}</p></div>
      <Button variant="outline" disabled={busy !== null} onClick={() => void remove(d)}>{busy === `${d.subscriptionId}:${d.hwid}` ? "Отключаем…" : "Отключить"}</Button>
    </div>)}
  </div>;
}

function Trial() {
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const navigate = useNavigate();
  const invalidate = useInvalidateClientData();
  const query = useQuery({ queryKey: ["bot-menu", "trials", state.token], queryFn: () => api.getClientAvailableTrials(state.token!) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function complete() {
    invalidate();
    await refreshProfile();
    navigate("/cabinet/dashboard", { replace: true });
  }
  async function activate() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try { await api.clientActivateTrial(state.token!); await complete(); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось активировать пробный период"); }
    finally { lock.current = false; setBusy(false); }
  }
  if (query.isLoading || !config) return <p>Загружаем пробные периоды…</p>;
  if (query.error) return <p role="alert">Не удалось загрузить пробные периоды. Попробуйте позже.</p>;
  if (query.data?.items.length) return <TrialsPickerDialog open token={state.token} onOpenChange={(open) => { if (!open) navigate("/cabinet/dashboard", { replace: true }); }} onActivated={() => void complete()} />;
  return <div className="space-y-4">{!query.data?.hasAnyEnabled && config.trialEnabled && !state.client?.trialUsed
    ? <><p>Пробный период: {config.trialDays} дн.</p><Button disabled={busy} onClick={() => void activate()}>{busy ? "Активируем…" : "Активировать пробный период"}</Button></>
    : <p>Доступных пробных периодов сейчас нет.</p>}{error && <p role="alert">{error}</p>}</div>;
}

function ServiceLinks({ proxy = false }: { proxy?: boolean }) {
  const config = useCabinetConfig();
  if (!config) return <p>Загрузка…</p>;
  const links = proxy
    ? config.tgProxyServers?.length ? config.tgProxyServers.map(s => ({ label: `${s.flag} ${s.name}`, url: s.url })) : [{ label: "Основной прокси", url: config.tgProxyUrlPrimary }, { label: "Резервный прокси", url: config.tgProxyUrlBackup }]
    : [{ label: "Написать в поддержку", url: config.supportLink }, { label: "Инструкция", url: config.instructionsLink }, { label: "Пользовательское соглашение", url: "/cabinet/documents/privacy" }, { label: "Оферта", url: "/cabinet/documents/offer" }, { label: "Политика возврата", url: "/cabinet/documents/refund" }, ...(config.ticketsEnabled ? [{ label: "Тикеты", url: "/cabinet/tickets" }] : [])];
  const visible = links.filter(link => link.url && /^(https?:\/\/|tg:\/\/|\/cabinet\/)/i.test(link.url));
  return <div className="space-y-3">{proxy && config.tgProxyText && <p className="whitespace-pre-wrap">{config.tgProxyText}</p>}{visible.map((link, i) => <Button key={i} variant="outline" className="flex w-full" asChild>{link.url!.startsWith("/cabinet/") ? <Link to={link.url!}>{link.label}</Link> : <a href={link.url!} target="_blank" rel="noopener noreferrer">{link.label}</a>}</Button>)}{!visible.length && <p>Ссылки пока не настроены.</p>}</div>;
}

const titles: Record<string, string> = { devices: "Мои устройства", topup: "Пополнить баланс", trial: "Пробный период", promocode: "Промокод", support: "Поддержка", "tg-proxy": "Прокси для Telegram" };

export function ClientBotMenuPage() {
  const { section = "" } = useParams();
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  if (!Object.prototype.hasOwnProperty.call(titles, section)) return <Navigate to="/cabinet/dashboard" replace />;
  return <section className="mx-auto w-full max-w-2xl space-y-5 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-6">
    <Link to="/cabinet/dashboard" className="text-sm text-muted-foreground">← В кабинет</Link>
    <h1 className="text-xl font-semibold">{titles[section]}</h1>
    {section === "devices" && <Devices />}
    {section === "topup" && <ClassicProfilePage topupOnly />}
    {section === "trial" && <Trial />}
    {section === "promocode" && <PromoCodeForm />}
    {section === "support" && <ServiceLinks />}
    {section === "tg-proxy" && <ServiceLinks proxy />}
  </section>;
}
