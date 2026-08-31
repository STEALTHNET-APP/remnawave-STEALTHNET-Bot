import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type BroadcastResult, type BroadcastProgress, type BroadcastHistoryItem, type ListSendJobStatus } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Paperclip, X, Mail, MessageSquare, Loader2, AlertTriangle, CheckCircle2,
  History as HistoryIcon, Eye, RefreshCw, Sparkles, Megaphone, Users, Image as ImageIcon, FileText, Film,
  Zap, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMsk } from "@/lib/datetime";
import { parseTable, autoDetectIdColumn, extractIds, autoDetectEmailColumn, extractEmails, type ParsedTable } from "@/lib/parse-id-list";

// 25.05.2026, WolfVPN — подняли с 20 до 50 МБ ради видео-вложений (sendVideo
// через основной bot API лимит ~50 МБ). Совпадает с лимитом multer на бэке.
const MAX_ATTACHMENT_MB = 50;

const BUTTON_ACTIONS = [
  { value: "", label: "Без кнопки" },
  { value: "menu:my_subs", label: " Мои подписки" },
  { value: "menu:tariffs", label: " Тарифы" },
  { value: "menu:topup", label: " Пополнить баланс" },
  { value: "menu:profile", label: " Профиль" },
  { value: "menu:trial", label: " Бесплатный триал" },
  { value: "menu:referral", label: " Реферальная программа" },
  { value: "menu:promocode", label: " Промокод" },
  { value: "menu:support", label: " Поддержка" },
  { value: "menu:vpn", label: " VPN подключение" },
  { value: "menu:devices", label: " Устройства" },
  { value: "menu:extra_options", label: " Доп. опции" },
  { value: "menu:main", label: " Главное меню" },
  { value: "webapp:/cabinet", label: " Web кабинет" },
  { value: "webapp:/cabinet/subscribe", label: " Страница подключения" },
  { value: "webapp:/cabinet/tickets", label: " Тикеты" },
  { value: "__custom_url__", label: " Своя ссылка (URL)" },
];

type ChannelKey = "telegram" | "email" | "both";

const CHANNEL_META: Record<ChannelKey, { label: string; desc: string; icon: typeof Send; gradient: string; ring: string; iconBg: string; accent: string }> = {
  telegram: {
    label: "Telegram",
    desc: "Сообщение в чат бота",
    icon: MessageSquare,
    gradient: "bg-muted",
    ring: "ring-sky-400/60 border-sky-400/40",
    iconBg: "bg-sky-500/20 text-sky-500 dark:text-sky-400",
    accent: "text-sky-500 dark:text-sky-400",
  },
  email: {
    label: "Email",
    desc: "Письмо с темой и вложением",
    icon: Mail,
    gradient: "bg-muted",
    ring: "ring-cyan-400/60 border-cyan-400/40",
    iconBg: "bg-cyan-500/20 text-cyan-500 dark:text-cyan-400",
    accent: "text-cyan-500 dark:text-cyan-400",
  },
  both: {
    label: "Telegram + Email",
    desc: "Отправить везде сразу",
    icon: Sparkles,
    gradient: "bg-muted",
    ring: "ring-fuchsia-400/60 border-fuchsia-400/40",
    iconBg: "bg-fuchsia-500/20 text-fuchsia-500 dark:text-fuchsia-400",
    accent: "text-fuchsia-500 dark:text-fuchsia-400",
  },
};

export function BroadcastPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? "";
  const [broadcastRecipients, setBroadcastRecipients] = useState<{ withTelegram: number; withEmail: number } | null>(null);
  const [broadcastChannel, setBroadcastChannel] = useState<ChannelKey>("telegram");
  // T-unify (12.05.2026, WolfVPN): целевая группа получателей.
  const [broadcastTargetGroup, setBroadcastTargetGroup] = useState<string>("all");
  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastAttachment, setBroadcastAttachment] = useState<File | null>(null);
  const [broadcastButtonText, setBroadcastButtonText] = useState("");
  const [broadcastButtonAction, setBroadcastButtonAction] = useState("");
  const [broadcastButtonCustomUrl, setBroadcastButtonCustomUrl] = useState("");
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);
  const [broadcastProgress, setBroadcastProgress] = useState<BroadcastProgress | null>(null);
  // 19.05.2026, WolfVPN — jobId активной рассылки + флаг «отмена запрошена».
  const [broadcastJobId, setBroadcastJobId] = useState<string | null>(null);
  const [broadcastCancelRequested, setBroadcastCancelRequested] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<"compose" | "single" | "history">("compose");
  // T-direct-send (WolfVPN): точечная отправка ОДНОМУ юзеру по Telegram ID.
  const [singleTgId, setSingleTgId] = useState("");
  const [singleMsg, setSingleMsg] = useState("");
  const [singleSending, setSingleSending] = useState(false);
  const [singleResult, setSingleResult] = useState<{ ok: boolean; error?: string } | null>(null);
  // T-list-send: режим (один / список) + состояние рассылки по списку Telegram ID.
  const [singleMode, setSingleMode] = useState<"one" | "list">("one");
  const [listRaw, setListRaw] = useState("");
  const [listMsg, setListMsg] = useState("");
  const [listSending, setListSending] = useState(false);
  const [listJob, setListJob] = useState<ListSendJobStatus | null>(null);
  const listPollRef = useRef(false);
  // T-list-send: загрузка списка из файла (.txt / .csv с несколькими столбцами).
  const [listTable, setListTable] = useState<ParsedTable | null>(null);
  const [listColIndex, setListColIndex] = useState(0);
  const [listFileName, setListFileName] = useState<string | null>(null);
  const listFileRef = useRef<HTMLInputElement>(null);
  // T-direct-send: общие для режимов «Один»/«Список» — вложение + inline-кнопка (как в обычной рассылке).
  const [singleAttachment, setSingleAttachment] = useState<File | null>(null);
  const [singleDragOver, setSingleDragOver] = useState(false);
  const singleFileRef = useRef<HTMLInputElement>(null);
  const [singleBtnAction, setSingleBtnAction] = useState("");
  const [singleBtnText, setSingleBtnText] = useState("");
  const [singleBtnCustomUrl, setSingleBtnCustomUrl] = useState("");
  // T-email-direct: канал (telegram/email) + поля email-режима.
  const [singleChannel, setSingleChannel] = useState<"telegram" | "email">("telegram");
  const [singleEmail, setSingleEmail] = useState("");
  const [singleSubject, setSingleSubject] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleBroadcastCancel() {
    if (!broadcastJobId || broadcastCancelRequested) return;
    if (!confirm("Прервать рассылку? Уже отправленные сообщения останутся.")) return;
    setBroadcastCancelRequested(true);
    try {
      await api.cancelBroadcast(token, broadcastJobId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      alert(`Не удалось отменить: ${msg}`);
      setBroadcastCancelRequested(false);
    }
  }

  // T-direct-send: отправить одно сообщение — Telegram (по id) или Email (по адресу).
  async function handleSendToUser(e: React.FormEvent) {
    e.preventDefault();
    const recipient = singleChannel === "email" ? singleEmail.trim() : singleTgId.trim();
    const text = singleMsg.trim();
    if (!recipient || !text || !token || singleSending) return;
    setSingleSending(true);
    setSingleResult(null);
    try {
      await api.sendBroadcastToUser(token, {
        channel: singleChannel,
        telegramId: recipient,
        subject: singleSubject,
        message: text,
        buttonText: singleBtnText,
        buttonUrl: resolvedSingleBtnUrl,
      }, singleAttachment);
      setSingleResult({ ok: true });
      setSingleMsg("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось отправить сообщение";
      setSingleResult({ ok: false, error: msg });
    } finally {
      setSingleSending(false);
    }
  }

  // T-list-send: распознанные получатели из textarea — ID (числа) или email, по каналу. Дедуп.
  const parsedListIds = useMemo(() => {
    const ids = listRaw.split(/[^\d]+/).map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(ids));
  }, [listRaw]);
  const parsedListEmails = useMemo(() => {
    const tokens = listRaw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(tokens.filter((t) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)).map((t) => t.toLowerCase())));
  }, [listRaw]);
  const parsedListRecipients = singleChannel === "email" ? parsedListEmails : parsedListIds;

  // T-list-send: применить выбранную колонку файла  заполнить textarea (ID или email по каналу).
  function applyTableColumn(table: ParsedTable, idx: number) {
    const vals = singleChannel === "email" ? extractEmails(table, idx) : extractIds(table, idx);
    setListRaw(vals.join("\n"));
    setListJob(null);
  }
  function handleListFile(file: File) {
    setListFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseTable(String(reader.result ?? ""));
      const col = singleChannel === "email" ? autoDetectEmailColumn(table) : autoDetectIdColumn(table);
      setListTable(table);
      setListColIndex(col);
      applyTableColumn(table, col);
    };
    reader.onerror = () => { setListFileName(null); setListTable(null); };
    reader.readAsText(file);
  }
  function handleListColChange(idx: number) {
    setListColIndex(idx);
    if (listTable) applyTableColumn(listTable, idx);
  }
  function clearListFile() {
    setListFileName(null);
    setListTable(null);
    setListColIndex(0);
  }

  // T-list-send: остановить polling при размонтировании.
  useEffect(() => () => { listPollRef.current = false; }, []);

  async function handleSendToList(e: React.FormEvent) {
    e.preventDefault();
    const text = listMsg.trim();
    if (!parsedListRecipients.length || !text || !token || listSending) return;
    setListSending(true);
    setListJob(null);
    try {
      const { jobId } = await api.startSendToList(token, { channel: singleChannel, telegramIds: parsedListRecipients, subject: singleSubject, message: text, buttonText: singleBtnText, buttonUrl: resolvedSingleBtnUrl }, singleAttachment);
      listPollRef.current = true;
      const poll = async () => {
        if (!listPollRef.current) return;
        try {
          const st = await api.getSendToListStatus(token, jobId);
          setListJob(st);
          if (st.done) {
            setListSending(false);
            listPollRef.current = false;
          } else {
            setTimeout(poll, 1200);
          }
        } catch {
          setListSending(false);
          listPollRef.current = false;
        }
      };
      poll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось запустить рассылку";
      setListSending(false);
      setListJob({ id: "", total: parsedListRecipients.length, sent: 0, failed: parsedListRecipients.length, done: true, errors: [{ telegramId: "—", error: msg }] });
    }
  }

  useEffect(() => {
    if (token) {
      api.broadcastRecipientsCount(token).then(setBroadcastRecipients).catch(() => setBroadcastRecipients(null));
    }
  }, [token]);

  const targetCount = useMemo(() => {
    if (!broadcastRecipients) return 0;
    if (broadcastChannel === "telegram") return broadcastRecipients.withTelegram;
    if (broadcastChannel === "email") return broadcastRecipients.withEmail;
    return broadcastRecipients.withTelegram + broadcastRecipients.withEmail;
  }, [broadcastRecipients, broadcastChannel]);

  async function handleBroadcastSend(e: React.FormEvent) {
    e.preventDefault();
    const text = broadcastMessage.trim();
    if (!text) return;
    if (broadcastAttachment && broadcastAttachment.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setBroadcastResult({
        ok: false,
        sentTelegram: 0,
        sentEmail: 0,
        failedTelegram: 0,
        failedEmail: 0,
        errors: [`Файл не должен превышать ${MAX_ATTACHMENT_MB} МБ`],
      });
      return;
    }
    setBroadcastLoading(true);
    setBroadcastResult(null);
    setBroadcastProgress(null);
    setBroadcastJobId(null);
    setBroadcastCancelRequested(false);
    try {
      const resolvedAction = broadcastButtonAction === "__custom_url__" ? broadcastButtonCustomUrl.trim() : broadcastButtonAction;
      const { jobId } = await api.broadcast(
        token,
        {
          channel: broadcastChannel,
          subject: broadcastSubject.trim() || undefined,
          message: text,
          buttonText: broadcastButtonText.trim() || undefined,
          buttonUrl: resolvedAction || undefined,
          targetGroup: broadcastTargetGroup === "all" ? undefined : broadcastTargetGroup,
        },
        broadcastAttachment ?? undefined
      );
      setBroadcastJobId(jobId);
      const finalResult = await pollBroadcastJob(jobId);
      setBroadcastResult(finalResult);
      if (finalResult.ok) {
        setBroadcastMessage("");
        setBroadcastSubject("");
        setBroadcastAttachment(null);
        setBroadcastButtonText("");
        setBroadcastButtonAction("");
        setBroadcastButtonCustomUrl("");
        api.broadcastRecipientsCount(token).then(setBroadcastRecipients).catch(() => {});
      }
    } catch (err) {
      setBroadcastResult({
        ok: false,
        sentTelegram: 0,
        sentEmail: 0,
        failedTelegram: 0,
        failedEmail: 0,
        errors: [err instanceof Error ? err.message : "Ошибка отправки"],
      });
    } finally {
      setBroadcastLoading(false);
      setBroadcastProgress(null);
    }
  }

  async function pollBroadcastJob(jobId: string): Promise<BroadcastResult> {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const s = await api.broadcastStatus(token, jobId);
        if (s.progress) setBroadcastProgress(s.progress);
        if (s.cancelRequested) setBroadcastCancelRequested(true);
        if (s.status === "completed" && s.result) return s.result;
        if (s.status === "cancelled") {
          // 19.05.2026, WolfVPN — рассылка прервана админом, возвращаем то что успели.
          return {
            ok: true,
            sentTelegram: s.progress?.sentTelegram ?? 0,
            sentEmail: s.progress?.sentEmail ?? 0,
            failedTelegram: s.progress?.failedTelegram ?? 0,
            failedEmail: s.progress?.failedEmail ?? 0,
            errors: s.result?.errors ?? [],
            cancelled: true,
          };
        }
        if (s.status === "error") {
          return {
            ok: false,
            sentTelegram: s.progress?.sentTelegram ?? 0,
            sentEmail: s.progress?.sentEmail ?? 0,
            failedTelegram: s.progress?.failedTelegram ?? 0,
            failedEmail: s.progress?.failedEmail ?? 0,
            errors: [s.error || "Ошибка рассылки"],
          };
        }
      } catch {
        // network blip — retry
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return {
      ok: false,
      sentTelegram: 0,
      sentEmail: 0,
      failedTelegram: 0,
      failedEmail: 0,
      errors: ["Превышен таймаут опроса статуса. Рассылка, возможно, всё ещё идёт — проверьте позже."],
    };
  }

  const channelMeta = CHANNEL_META[broadcastChannel];

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setBroadcastAttachment(f);
  }

  // T-direct-send: итоговый URL/действие кнопки (для __custom_url__ берём введённую ссылку).
  const resolvedSingleBtnUrl = singleBtnAction === "__custom_url__" ? singleBtnCustomUrl.trim() : singleBtnAction;

  // T-direct-send: общий блок «вложение + кнопка» для обоих режимов вкладки «Личное».
  const singleRichControls = (
    <>
      {/* ВЛОЖЕНИЕ */}
      <section>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
          <Paperclip className="inline h-3 w-3 mr-1" /> Вложение
          <span className="ml-1 text-[10px] normal-case text-muted-foreground/70">до {MAX_ATTACHMENT_MB} МБ (необязательно)</span>
        </Label>
        <input
          ref={singleFileRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => setSingleAttachment(e.target.files?.[0] ?? null)}
        />
        {!singleAttachment ? (
          <div
            onClick={() => singleFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setSingleDragOver(true); }}
            onDragLeave={() => setSingleDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setSingleDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) setSingleAttachment(f); }}
            className={cn(
              "cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all",
              singleDragOver ? "border-sky-400/60 bg-sky-500/10" : "border-border bg-foreground/[0.02] dark:bg-white/[0.02] hover:border-border hover:bg-white/[0.04]"
            )}
          >
            <ImageIcon className={cn("h-7 w-7 mx-auto mb-2", singleDragOver ? "text-sky-500" : "text-muted-foreground")} />
            <p className="text-sm font-medium">Перетащи файл сюда или <span className="text-sky-500 underline">выбери</span></p>
            <p className="text-[11px] text-muted-foreground mt-1">Картинка  фото, видео  плеер, остальное  файл</p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-3 rounded-xl border border-sky-400/30 bg-sky-500/10 p-3.5"
          >
            <div className="h-9 w-11 rounded-xl bg-sky-500/20 flex items-center justify-center shrink-0">
              {singleAttachment.type.startsWith("image/")
                ? <ImageIcon className="h-5 w-5 text-sky-500" />
                : singleAttachment.type.startsWith("video/")
                  ? <Film className="h-5 w-5 text-sky-500" />
                  : <FileText className="h-5 w-5 text-sky-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{singleAttachment.name}</p>
              <p className="text-[11px] text-muted-foreground">{(singleAttachment.size / 1024).toFixed(1)} КБ · {singleAttachment.type || "—"}</p>
            </div>
            <button
              type="button"
              onClick={() => setSingleAttachment(null)}
              className="h-8 w-8 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center justify-center transition"
              aria-label="Удалить вложение"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </section>

      {/* INLINE-КНОПКА (только Telegram — email не поддерживает inline-кнопки) */}
      {singleChannel === "telegram" && (
      <section>
        <div className="rounded-xl border border-sky-500/20 bg-muted p-4 space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Кнопка под сообщением <span className="text-[11px] font-normal text-muted-foreground">(необязательно)</span></p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Действие</Label>
              <select
                className="flex h-9 w-full rounded-xl border border-border bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
                value={singleBtnAction}
                onChange={(e) => setSingleBtnAction(e.target.value)}
              >
                {BUTTON_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            {singleBtnAction && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Текст кнопки</Label>
                <Input
                  value={singleBtnText}
                  onChange={(e) => setSingleBtnText(e.target.value)}
                  placeholder="Открыть тарифы"
                  maxLength={64}
                  className="h-9 rounded-xl bg-card border-border focus-visible:ring-sky-500/40"
                />
              </div>
            )}
          </div>
          {singleBtnAction === "__custom_url__" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Ссылка (URL)</Label>
              <Input
                value={singleBtnCustomUrl}
                onChange={(e) => setSingleBtnCustomUrl(e.target.value)}
                placeholder="https://example.com/tariffs"
                maxLength={500}
                className="h-9 rounded-xl bg-card border-border focus-visible:ring-sky-500/40"
              />
            </div>
          )}
          {singleBtnAction && !singleBtnText.trim() && (
            <p className="text-[11px] text-amber-500">Укажите текст кнопки, иначе она не добавится.</p>
          )}
        </div>
      </section>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-3.5 relative">
      {/* Декоративные блобы фона */}

      {/* HERO */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden bg-card border border-border p-4 rounded-[2.5rem]"
      >
        <div className="absolute inset-0 bg-transparent pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/20 blur-3xl rounded-full pointer-events-none" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <motion.div
              animate={{ rotate: [0, -8, 8, -4, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 4 }}
              className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center border border-border shrink-0"
            >
              <Megaphone className="h-5 w-5 text-primary" />
            </motion.div>
            <div>
              <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
                Рассылка
              </h1>
              <p className="text-[12.5px] text-muted-foreground mt-[3px] max-w-md">
                Отправляй сообщения клиентам в Telegram и/или на email — с кнопками, фото и файлами
              </p>
            </div>
          </div>
          {broadcastRecipients && (
            <div className="flex flex-wrap gap-2">
              <StatPill icon={MessageSquare} label="Telegram" value={broadcastRecipients.withTelegram} colorClass="bg-muted text-sky-500 dark:text-sky-400 border-sky-400/30" />
              <StatPill icon={Mail} label="Email" value={broadcastRecipients.withEmail} colorClass="bg-muted text-cyan-500 dark:text-cyan-400 border-cyan-400/30" />
              <StatPill icon={Users} label="Всего" value={broadcastRecipients.withTelegram + broadcastRecipients.withEmail} colorClass="bg-muted text-fuchsia-500 dark:text-fuchsia-400 border-fuchsia-400/30" />
            </div>
          )}
        </div>
      </motion.div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "compose" | "history")} className="w-full">
        <TabsList className="bg-card border border-border rounded-xl p-1.5 h-auto">
          <TabsTrigger value="compose" className="rounded-xl px-5 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
            <Send className="h-4 w-4 mr-2" /> Создать
          </TabsTrigger>
          <TabsTrigger value="single" className="rounded-xl px-5 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
            <MessageSquare className="h-4 w-4 mr-2" /> Личное
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-xl px-5 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:text-white data-[state=active]:shadow-md">
            <HistoryIcon className="h-4 w-4 mr-2" /> История
          </TabsTrigger>
        </TabsList>

        {/*  COMPOSE  */}
        <TabsContent value="compose" className="mt-5 space-y-5">
          <Card className="relative overflow-hidden bg-card border-border rounded-2xl">
            <div className={cn("absolute inset-x-0 top-0 h-1 ", channelMeta.gradient)} />
            <form onSubmit={handleBroadcastSend} className="p-4 sm:p-7 space-y-7">

              {/* CHANNEL CARDS */}
              <section>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-3 block">
                  <Zap className="inline h-3 w-3 mr-1" /> Канал отправки
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(Object.keys(CHANNEL_META) as ChannelKey[]).map((c) => {
                    const meta = CHANNEL_META[c];
                    const Icon = meta.icon;
                    const isActive = broadcastChannel === c;
                    const recipients = c === "telegram"
                      ? broadcastRecipients?.withTelegram
                      : c === "email"
                        ? broadcastRecipients?.withEmail
                        : (broadcastRecipients ? broadcastRecipients.withTelegram + broadcastRecipients.withEmail : 0);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBroadcastChannel(c)}
                        className={cn(
                          "relative overflow-hidden text-left rounded-xl border p-4 transition-all duration-200",
                          "hover:scale-[1.02]",
                          isActive
                            ? cn("ring-2", meta.gradient, meta.ring, "shadow-lg")
                            : "bg-foreground/[0.02] dark:bg-white/[0.02] border-border hover:border-border"
                        )}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="channelGlow"
                            className="absolute -top-8 -right-8 w-24 h-24 bg-card rounded-full blur-2xl pointer-events-none"
                          />
                        )}
                        <div className="relative flex items-start gap-3">
                          <div className={cn("h-9 w-11 rounded-xl flex items-center justify-center shrink-0", meta.iconBg)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("font-semibold text-sm", isActive && meta.accent)}>{meta.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{meta.desc}</p>
                            {recipients != null && (
                              <p className="text-[11px] mt-1.5">
                                <span className="text-muted-foreground">Получателей: </span>
                                <span className={cn("font-bold", isActive ? meta.accent : "text-foreground")}>{recipients}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* T-unify (12.05.2026, WolfVPN): селектор целевой группы получателей */}
              <section>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-3 block">
                  <Zap className="inline h-3 w-3 mr-1" /> Кому отправлять
                </Label>
                <select
                  value={broadcastTargetGroup}
                  onChange={(e) => setBroadcastTargetGroup(e.target.value)}
                  className="w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.04] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all"> Все клиенты</option>
                  <option value="with_any_subs"> С любыми подписками</option>
                  <option value="without_subs"> Без подписок</option>
                  <option value="active_subs"> С активными подписками</option>
                  <option value="expired_subs"> С истёкшими подписками</option>
                  <option value="standard_subs"> Со Стандартной подпиской</option>
                  <option value="unblock_subs"> С Unblock-подпиской</option>
                  <option value="unblock_unlimited"> С Безлимитным Unblock</option>
                </select>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Фильтр по тарифам — через menu_emoji ( /  / ). Активные/Истёкшие — точный фильтр по expireAt подписок.
                </p>
              </section>

              {/* SUBJECT (email only) */}
              <AnimatePresence>
                {(broadcastChannel === "email" || broadcastChannel === "both") && (
                  <motion.section
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                      <Mail className="inline h-3 w-3 mr-1" /> Тема письма
                    </Label>
                    <Input
                      value={broadcastSubject}
                      onChange={(e) => setBroadcastSubject(e.target.value)}
                      placeholder="Сообщение от сервиса"
                      maxLength={500}
                      className="h-9 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-cyan-500/40"
                    />
                  </motion.section>
                )}
              </AnimatePresence>

              {/* MESSAGE */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    <FileText className="inline h-3 w-3 mr-1" /> Текст сообщения
                  </Label>
                  <span className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded-full border",
                    broadcastMessage.length > 3800
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      : "bg-foreground/5 text-muted-foreground border-border"
                  )}>
                    {broadcastMessage.length} / 4096
                  </span>
                </div>
                <textarea
                  className="flex min-h-[180px] w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-y leading-relaxed"
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  placeholder={`Введите текст рассылки.\n\nДля Telegram поддерживается HTML: <b>жирный</b>, <i>курсив</i>, <a href="...">ссылки</a>.`}
                  maxLength={4096}
                  required
                />
              </section>

              {/* ATTACHMENT (drag-drop) */}
              <section>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                  <Paperclip className="inline h-3 w-3 mr-1" /> Вложение
                  <span className="ml-1 text-[10px] normal-case text-muted-foreground/70">до {MAX_ATTACHMENT_MB} МБ</span>
                </Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  /* 25.05.2026, WolfVPN — добавили video/* (mp4, mov, webm и т.д.) */
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                  className="hidden"
                  onChange={(e) => setBroadcastAttachment(e.target.files?.[0] ?? null)}
                />
                {!broadcastAttachment ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    className={cn(
                      "cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all",
                      dragOver
                        ? "border-border bg-primary/10"
                        : "border-border bg-foreground/[0.02] dark:bg-white/[0.02] hover:border-border hover:bg-white/[0.04]"
                    )}
                  >
                    <ImageIcon className={cn("h-8 w-8 mx-auto mb-2", dragOver ? "text-primary" : "text-muted-foreground")} />
                    <p className="text-sm font-medium">Перетащи файл сюда или <span className="text-primary underline">выбери</span></p>
                    {/* 25.05.2026, WolfVPN — добавили видео в список форматов. */}
                    <p className="text-[11px] text-muted-foreground mt-1">Картинки  как фото с подписью. Видео  как плеер с подписью. Документы  как файл.</p>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 rounded-xl border border-border bg-primary/10 p-4"
                  >
                    <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                      {/* 25.05.2026, WolfVPN — отдельная иконка Film для видео. */}
                      {broadcastAttachment.type.startsWith("image/")
                        ? <ImageIcon className="h-6 w-6 text-primary" />
                        : broadcastAttachment.type.startsWith("video/")
                          ? <Film className="h-6 w-6 text-primary" />
                          : <FileText className="h-6 w-6 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{broadcastAttachment.name}</p>
                      <p className="text-[11px] text-muted-foreground">{(broadcastAttachment.size / 1024).toFixed(1)} КБ · {broadcastAttachment.type || "—"}</p>
                    </div>
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center justify-center transition"
                      onClick={() => setBroadcastAttachment(null)}
                      aria-label="Удалить вложение"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </motion.div>
                )}
              </section>

              {/* INLINE BUTTON (Telegram only) */}
              <AnimatePresence>
                {(broadcastChannel === "telegram" || broadcastChannel === "both") && (
                  <motion.section
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-sky-500/20 bg-muted p-4 space-y-4">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-semibold">Кнопка под сообщением</p>
                          <p className="text-[11px] text-muted-foreground">Только для Telegram</p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Действие</Label>
                          <select
                            className="flex h-9 w-full rounded-xl border border-border bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
                            value={broadcastButtonAction}
                            onChange={(e) => setBroadcastButtonAction(e.target.value)}
                          >
                            {BUTTON_ACTIONS.map((a) => (
                              <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                          </select>
                        </div>
                        {broadcastButtonAction && (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Текст кнопки</Label>
                            <Input
                              value={broadcastButtonText}
                              onChange={(e) => setBroadcastButtonText(e.target.value)}
                              placeholder="Открыть тарифы"
                              maxLength={64}
                              className="h-9 rounded-xl bg-card border-border focus-visible:ring-sky-500/40"
                            />
                          </div>
                        )}
                      </div>
                      {broadcastButtonAction === "__custom_url__" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Ссылка (URL)</Label>
                          <Input
                            value={broadcastButtonCustomUrl}
                            onChange={(e) => setBroadcastButtonCustomUrl(e.target.value)}
                            placeholder="https://example.com/tariffs"
                            maxLength={500}
                            className="h-9 rounded-xl bg-card border-border focus-visible:ring-sky-500/40"
                          />
                        </div>
                      )}
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              {/* SUBMIT */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Будет отправлено: <strong className={channelMeta.accent}>{targetCount.toLocaleString("ru-RU")}</strong> получателей
                </p>
                <Button
                  type="submit"
                  disabled={broadcastLoading || !broadcastMessage.trim()}
                  className="h-12 px-8 rounded-xl text-base font-semibold gap-2 bg-primary shadow-primary/30 disabled:opacity-50"
                >
                  {broadcastLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  {broadcastLoading ? "Идёт рассылка…" : "Запустить рассылку"}
                </Button>
              </div>

              {broadcastLoading && broadcastProgress && !broadcastResult && (
                <BroadcastProgressPanel
                  progress={broadcastProgress}
                  cancelRequested={broadcastCancelRequested}
                  onCancel={broadcastJobId ? handleBroadcastCancel : undefined}
                />
              )}

              {broadcastResult && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded-xl border p-4 text-sm",
                    broadcastResult.ok
                      ? "border-emerald-500/30 bg-muted"
                      : "border-amber-500/30 bg-muted"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                      broadcastResult.ok ? "bg-emerald-500/20" : "bg-amber-500/20")}>
                      {broadcastResult.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
                    </div>
                    <div className="flex-1">
                      <p className={cn("font-semibold mb-2", broadcastResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                        {broadcastResult.ok ? "Рассылка успешно завершена!" : "Рассылка завершена с предупреждениями"}
                      </p>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {broadcastResult.sentTelegram > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 px-2.5 py-1 rounded-lg">
                            <MessageSquare className="h-3 w-3" /> TG: {broadcastResult.sentTelegram}
                          </span>
                        )}
                        {broadcastResult.sentEmail > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 px-2.5 py-1 rounded-lg">
                            <Mail className="h-3 w-3" /> Email: {broadcastResult.sentEmail}
                          </span>
                        )}
                        {(broadcastResult.failedTelegram + broadcastResult.failedEmail) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 px-2.5 py-1 rounded-lg">
                            <X className="h-3 w-3" /> Ошибок: {broadcastResult.failedTelegram + broadcastResult.failedEmail}
                          </span>
                        )}
                      </div>
                      {broadcastResult.errors.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Показать ошибки ({broadcastResult.errors.length})</summary>
                          <ul className="mt-2 list-disc pl-4 text-xs text-foreground/70 space-y-0.5 max-h-40 overflow-y-auto">
                            {broadcastResult.errors.map((err, i) => (<li key={i}>{err}</li>))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </form>
          </Card>
        </TabsContent>

        {/*  SINGLE (точечная отправка одному юзеру)  */}
        <TabsContent value="single" className="mt-5">
          <Card className="relative overflow-hidden bg-card border-border rounded-2xl max-w-2xl">
            <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
            <div className="p-4 sm:p-7 space-y-6">
              {/* HEADER + переключатель режима */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="font-bold text-lg leading-tight">Личное сообщение</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {singleChannel === "email"
                        ? (singleMode === "one" ? "Отправить письмо одному адресату" : "Отправить письмо списку адресов")
                        : (singleMode === "one" ? "Отправить в Telegram одному пользователю по его ID" : "Отправить в Telegram сразу списку пользователей")}
                    </p>
                  </div>
                </div>
                <div className="inline-flex rounded-xl bg-card border border-border p-1 gap-1 self-start shrink-0">
                  <button
                    type="button"
                    onClick={() => setSingleMode("one")}
                    className={cn(
                      "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                      singleMode === "one" ? "bg-primary text-white shadow" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <MessageSquare className="inline h-3.5 w-3.5 mr-1.5" />Один
                  </button>
                  <button
                    type="button"
                    onClick={() => setSingleMode("list")}
                    className={cn(
                      "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                      singleMode === "list" ? "bg-primary text-white shadow" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Users className="inline h-3.5 w-3.5 mr-1.5" />Список
                  </button>
                </div>
              </div>

              {/* КАНАЛ: Telegram / Email */}
              <div className="inline-flex rounded-xl bg-card border border-border p-1 gap-1">
                <button
                  type="button"
                  onClick={() => { setSingleChannel("telegram"); setSingleResult(null); setListJob(null); setListRaw(""); setListTable(null); setListFileName(null); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    singleChannel === "telegram" ? "bg-primary text-white shadow" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageSquare className="inline h-3.5 w-3.5 mr-1.5" />Telegram
                </button>
                <button
                  type="button"
                  onClick={() => { setSingleChannel("email"); setSingleResult(null); setListJob(null); setListRaw(""); setListTable(null); setListFileName(null); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    singleChannel === "email" ? "bg-primary text-white shadow" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Mail className="inline h-3.5 w-3.5 mr-1.5" />Email
                </button>
              </div>

              {/*  РЕЖИМ: ОДИН ПОЛУЧАТЕЛЬ  */}
              {singleMode === "one" && (
                <form onSubmit={handleSendToUser} className="space-y-6">
                  {/* ПОЛУЧАТЕЛЬ */}
                  {singleChannel === "telegram" ? (
                    <section>
                      <Label htmlFor="single-tg-id" className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                        <Users className="inline h-3 w-3 mr-1" /> Telegram ID получателя
                      </Label>
                      <Input
                        id="single-tg-id"
                        value={singleTgId}
                        onChange={(e) => { setSingleTgId(e.target.value.replace(/\D/g, "")); setSingleResult(null); }}
                        placeholder="например, 488948685"
                        inputMode="numeric"
                        className="rounded-xl"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        Числовой ID из Telegram. Пользователь должен был хоть раз написать боту, иначе отправка невозможна.
                      </p>
                    </section>
                  ) : (
                    <>
                      <section>
                        <Label htmlFor="single-email" className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                          <Mail className="inline h-3 w-3 mr-1" /> Email получателя
                        </Label>
                        <Input
                          id="single-email"
                          type="email"
                          value={singleEmail}
                          onChange={(e) => { setSingleEmail(e.target.value); setSingleResult(null); }}
                          placeholder="user@example.com"
                          className="rounded-xl"
                        />
                      </section>
                      <section>
                        <Label htmlFor="single-subject" className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                          <FileText className="inline h-3 w-3 mr-1" /> Тема письма
                        </Label>
                        <Input
                          id="single-subject"
                          value={singleSubject}
                          onChange={(e) => setSingleSubject(e.target.value)}
                          placeholder="Сообщение от сервиса"
                          maxLength={300}
                          className="rounded-xl"
                        />
                      </section>
                    </>
                  )}

                  {/* MESSAGE */}
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="single-msg" className="text-xs uppercase tracking-wider text-muted-foreground block">
                        <MessageSquare className="inline h-3 w-3 mr-1" /> Текст сообщения
                      </Label>
                      <span className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full border",
                        singleMsg.length > 3800
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          : "bg-foreground/5 text-muted-foreground border-border"
                      )}>
                        {singleMsg.length} / 4096
                      </span>
                    </div>
                    <textarea
                      id="single-msg"
                      className="flex min-h-[160px] w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 resize-y leading-relaxed"
                      value={singleMsg}
                      onChange={(e) => { setSingleMsg(e.target.value); setSingleResult(null); }}
                      placeholder={`Введите текст сообщения.\n\nПоддерживается HTML: <b>жирный</b>, <i>курсив</i>, <a href="...">ссылка</a>.`}
                      maxLength={4096}
                      required
                    />
                  </section>

                  {singleRichControls}

                  {/* RESULT */}
                  <AnimatePresence>
                    {singleResult && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={cn(
                          "flex items-center gap-2 rounded-xl px-4 py-3 text-sm border",
                          singleResult.ok
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                        )}
                      >
                        {singleResult.ok
                          ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> Сообщение отправлено!</>
                          : <><AlertTriangle className="h-4 w-4 shrink-0" /> {singleResult.error}</>}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* SUBMIT */}
                  <Button
                    type="submit"
                    disabled={singleSending || (singleChannel === "email" ? !singleEmail.trim() : !singleTgId.trim()) || !singleMsg.trim()}
                    className="w-full h-12 rounded-xl text-base font-semibold bg-primary text-white shadow-sky-500/20 transition-all"
                  >
                    {singleSending
                      ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Отправка…</>
                      : <><Send className="h-5 w-5 mr-2" /> Отправить сообщение</>}
                  </Button>
                </form>
              )}

              {/*  РЕЖИМ: СПИСОК ID  */}
              {singleMode === "list" && (
                <form onSubmit={handleSendToList} className="space-y-6">
                  {/* ИСТОЧНИК: загрузка файла */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={listFileRef}
                      type="file"
                      accept=".txt,.csv,text/plain,text/csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleListFile(f); e.target.value = ""; }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => listFileRef.current?.click()}
                      className="rounded-xl border-border"
                    >
                      <Paperclip className="h-4 w-4 mr-2" /> Загрузить .txt / .csv
                    </Button>
                    <span className="text-[11px] text-muted-foreground">или вставьте ID вручную ниже</span>
                    {listFileName && (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground/5 border border-border">
                        <FileText className="h-3.5 w-3.5 shrink-0" /> {listFileName}
                        <button type="button" onClick={clearListFile} className="hover:text-foreground" aria-label="Убрать файл">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </div>

                  {/* ВЫБОР КОЛОНКИ (если в файле несколько столбцов) */}
                  {listTable && listTable.columnCount > 1 && (
                    <div className="rounded-xl border border-sky-400/30 bg-sky-500/5 p-3.5 space-y-2.5">
                      <p className="text-xs text-muted-foreground">
                        В файле <b className="text-foreground">{listTable.columnCount}</b> {listTable.columnCount < 5 ? "столбца" : "столбцов"} — выбери, в каком {singleChannel === "email" ? "Email" : "Telegram ID"}:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: listTable.columnCount }).map((_, idx) => {
                          const label = listTable.header?.[idx] || `Колонка ${idx + 1}`;
                          const sampleRow = listTable.hasHeader ? listTable.rows[1] : listTable.rows[0];
                          const sample = sampleRow?.[idx] ?? "";
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleListColChange(idx)}
                              className={cn(
                                "px-3 py-1.5 rounded-xl text-xs border transition-all text-left",
                                listColIndex === idx
                                  ? "bg-sky-500 text-white border-sky-500 shadow"
                                  : "bg-card border-border hover:border-border"
                              )}
                            >
                              <span className="font-medium block">{label}</span>
                              {sample && <span className="block text-[10px] opacity-70 truncate max-w-[120px]">{sample}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* RECIPIENTS */}
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="list-ids" className="text-xs uppercase tracking-wider text-muted-foreground block">
                        {singleChannel === "email"
                          ? <><Mail className="inline h-3 w-3 mr-1" /> Список Email</>
                          : <><Users className="inline h-3 w-3 mr-1" /> Список Telegram ID</>}
                      </Label>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30">
                        распознано: {parsedListRecipients.length}
                      </span>
                    </div>
                    <textarea
                      id="list-ids"
                      className="flex min-h-[120px] w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 resize-y leading-relaxed"
                      value={listRaw}
                      onChange={(e) => { setListRaw(e.target.value); setListJob(null); }}
                      placeholder={singleChannel === "email"
                        ? "Вставьте email — по одному на строку\nили через запятую/пробел:\n\nuser@example.com\nivan@mail.ru, petr@gmail.com"
                        : "Вставьте ID получателей — по одному на строку\nили через запятую/пробел:\n\n488948685\n123456789, 987654321"}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {singleChannel === "email" ? "Дубликаты и некорректные адреса отбрасываются автоматически." : "Дубликаты и нечисловые значения отбрасываются автоматически."}
                    </p>
                  </section>

                  {/* SUBJECT (email) */}
                  {singleChannel === "email" && (
                    <section>
                      <Label htmlFor="list-subject" className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                        <FileText className="inline h-3 w-3 mr-1" /> Тема письма
                      </Label>
                      <Input
                        id="list-subject"
                        value={singleSubject}
                        onChange={(e) => setSingleSubject(e.target.value)}
                        placeholder="Сообщение от сервиса"
                        maxLength={300}
                        className="rounded-xl"
                      />
                    </section>
                  )}

                  {/* MESSAGE */}
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="list-msg" className="text-xs uppercase tracking-wider text-muted-foreground block">
                        <MessageSquare className="inline h-3 w-3 mr-1" /> Текст сообщения
                      </Label>
                      <span className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full border",
                        listMsg.length > 3800
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          : "bg-foreground/5 text-muted-foreground border-border"
                      )}>
                        {listMsg.length} / 4096
                      </span>
                    </div>
                    <textarea
                      id="list-msg"
                      className="flex min-h-[140px] w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 resize-y leading-relaxed"
                      value={listMsg}
                      onChange={(e) => setListMsg(e.target.value)}
                      placeholder={`Введите текст сообщения.\n\nПоддерживается HTML: <b>жирный</b>, <i>курсив</i>, <a href="...">ссылка</a>.`}
                      maxLength={4096}
                      required
                    />
                  </section>

                  {singleRichControls}

                  {/* ПРОГРЕСС / ОТЧЁТ */}
                  <AnimatePresence>
                    {listJob && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="rounded-xl border border-border bg-foreground/[0.02] p-4 space-y-3"
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-muted-foreground">{listJob.done ? "Готово" : "Отправка…"}</span>
                            <span className="font-medium">{listJob.sent + listJob.failed} / {listJob.total}</span>
                          </div>
                          <div className="h-2 rounded-full bg-card overflow-hidden">
                            <motion.div
                              className="h-full bg-primary"
                              initial={{ width: 0 }}
                              animate={{ width: `${listJob.total ? Math.round(((listJob.sent + listJob.failed) / listJob.total) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Доставлено: {listJob.sent}
                          </span>
                          {listJob.failed > 0 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30">
                              <AlertTriangle className="h-3.5 w-3.5" /> Ошибок: {listJob.failed}
                            </span>
                          )}
                        </div>
                        {listJob.done && listJob.errors.length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Показать ошибки ({listJob.errors.length})</summary>
                            <div className="mt-2 max-h-40 overflow-auto space-y-1 rounded-xl bg-card p-2 font-mono">
                              {listJob.errors.map((er, i) => (
                                <div key={i} className="text-red-500/90"><span className="text-muted-foreground">{er.telegramId}:</span> {er.error}</div>
                              ))}
                            </div>
                          </details>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* SUBMIT */}
                  <Button
                    type="submit"
                    disabled={listSending || !parsedListRecipients.length || !listMsg.trim()}
                    className="w-full h-12 rounded-xl text-base font-semibold bg-primary text-white shadow-sky-500/20 transition-all"
                  >
                    {listSending
                      ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Рассылка… {listJob ? `${listJob.sent + listJob.failed}/${listJob.total}` : ""}</>
                      : <><Send className="h-5 w-5 mr-2" /> Разослать{parsedListRecipients.length > 0 ? ` (${parsedListRecipients.length})` : ""}</>}
                  </Button>
                </form>
              )}
            </div>
          </Card>
        </TabsContent>

        {/*  HISTORY  */}
        <TabsContent value="history" className="mt-5">
          <BroadcastHistoryPanel token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatPill({ icon: Icon, label, value, colorClass }: { icon: typeof Send; label: string; value: number; colorClass: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-xl  border px-4 py-2 shadow-sm", colorClass)}>
      <Icon className="h-4 w-4" />
      <div>
        <p className="text-[10px] uppercase tracking-wide opacity-80 leading-none mb-0.5">{label}</p>
        <p className="text-base font-bold leading-none">{value.toLocaleString("ru-RU")}</p>
      </div>
    </div>
  );
}

function BroadcastProgressPanel({
  progress,
  onCancel,
  cancelRequested,
}: {
  progress: BroadcastProgress;
  onCancel?: () => void;
  cancelRequested?: boolean;
}) {
  const tgDone = progress.sentTelegram + progress.failedTelegram;
  const emailDone = progress.sentEmail + progress.failedEmail;
  const tgPct = progress.totalTelegram > 0 ? Math.min(100, Math.round((tgDone / progress.totalTelegram) * 100)) : 0;
  const emailPct = progress.totalEmail > 0 ? Math.min(100, Math.round((emailDone / progress.totalEmail) * 100)) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-muted p-4 text-sm space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="absolute inset-0 rounded-xl ring-2 ring-primary/30 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">
              {cancelRequested
                ? " Останавливаем рассылку…"
                : `Рассылка идёт${progress.currentChannel === "telegram" ? " — Telegram" : progress.currentChannel === "email" ? " — Email" : ""}…`}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {cancelRequested
                ? "Прервёмся между сообщениями (≤ 1 сек)"
                : "Не закрывай вкладку до завершения"}
            </p>
          </div>
        </div>
        {onCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={cancelRequested}
            className="shrink-0 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            {cancelRequested ? "Отменяю…" : "Отменить"}
          </Button>
        )}
      </div>
      {progress.totalTelegram > 0 && (
        <ProgressBar
          label="Telegram"
          icon={MessageSquare}
          done={tgDone}
          total={progress.totalTelegram}
          failed={progress.failedTelegram}
          pct={tgPct}
          colorClass="bg-primary"
          labelColor="text-sky-500 dark:text-sky-400"
        />
      )}
      {progress.totalEmail > 0 && (
        <ProgressBar
          label="Email"
          icon={Mail}
          done={emailDone}
          total={progress.totalEmail}
          failed={progress.failedEmail}
          pct={emailPct}
          colorClass="bg-primary"
          labelColor="text-cyan-500 dark:text-cyan-400"
        />
      )}
      {progress.totalTelegram === 0 && progress.totalEmail === 0 && (
        <p className="text-xs text-muted-foreground">Подготавливаем получателей…</p>
      )}
    </motion.div>
  );
}

function ProgressBar({ label, icon: Icon, done, total, failed, pct, colorClass, labelColor }: { label: string; icon: typeof Mail; done: number; total: number; failed: number; pct: number; colorClass: string; labelColor: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className={cn("inline-flex items-center gap-1.5 font-medium", labelColor)}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="text-muted-foreground font-mono">
          <strong className="text-foreground">{done}</strong> / {total}
          {failed > 0 && <span className="ml-2 text-amber-500">·  {failed}</span>}
          <span className="ml-2 text-[10px] opacity-70">{pct}%</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-foreground/10 dark:bg-card overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function statusBadge(status: BroadcastHistoryItem["status"]): { text: string; cls: string; dot: string } {
  if (status === "completed") return { text: "Готово", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500" };
  if (status === "running") return { text: "Идёт…", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", dot: "bg-amber-500 animate-pulse" };
  return { text: "Ошибка", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", dot: "bg-red-500" };
}

function channelLabel(c: BroadcastHistoryItem["channel"]): string {
  if (c === "telegram") return "Telegram";
  if (c === "email") return "Email";
  return "TG + Email";
}

function channelMetaIcon(c: BroadcastHistoryItem["channel"]) {
  if (c === "telegram") return { Icon: MessageSquare, cls: "bg-sky-500/15 text-sky-500 dark:text-sky-400" };
  if (c === "email") return { Icon: Mail, cls: "bg-cyan-500/15 text-cyan-500 dark:text-cyan-400" };
  return { Icon: Sparkles, cls: "bg-fuchsia-500/15 text-fuchsia-500 dark:text-fuchsia-400" };
}

function BroadcastHistoryPanel({ token }: { token: string }) {
  const [items, setItems] = useState<BroadcastHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<BroadcastHistoryItem | null>(null);
  // 25.05.2026, WolfVPN — state для функции «Возобновить рассылку».
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // 25.05.2026, WolfVPN — state для «Остановить» из истории (живой cancel либо zombie cleanup).
  const [stopLoading, setStopLoading] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  // 25.05.2026, WolfVPN — скачивание CSV получателей.
  const [recipientsLoading, setRecipientsLoading] = useState(false);

  const handleDownloadRecipients = async () => {
    if (!detail) return;
    setRecipientsLoading(true);
    try {
      await api.downloadBroadcastRecipientsCsv(token, detail.id);
    } catch (e) {
      alert(`Не удалось скачать: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRecipientsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!detail) return;
    if (!window.confirm("Остановить эту рассылку? Если она ещё идёт — прервётся между сообщениями. Если зависла — будет помечена как cancelled.")) return;
    setStopLoading(true);
    setStopError(null);
    try {
      await api.cancelBroadcast(token, detail.id);
      setDetail(null);
      await load();
    } catch (e) {
      setStopError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopLoading(false);
    }
  };

  const handleResume = async (file: File | null) => {
    if (!detail) return;
    setResumeError(null);
    if (detail.attachmentName && !file) {
      setResumeError(`Нужно переаплоадить файл "${detail.attachmentName}"`);
      return;
    }
    setResumeLoading(true);
    try {
      const res = await api.resumeBroadcast(token, detail.id, file ?? undefined);
      if (!res.jobId) throw new Error("сервер не вернул jobId");
      setDetail(null);
      await load();
      alert(`Рассылка возобновлена (jobId=${res.jobId}). Уже отправленные ${detail.sentTelegram} получателей будут пропущены.`);
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : String(e));
    } finally {
      setResumeLoading(false);
      if (resumeFileInputRef.current) resumeFileInputRef.current.value = "";
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getBroadcastHistory(token, 100, 0);
      setItems(r.items);
      setTotal(r.total);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Aggregate stats для верхних карточек.
  const stats = useMemo(() => {
    let totalSentTg = 0, totalSentEmail = 0, totalFailed = 0, completed = 0;
    for (const it of items) {
      totalSentTg += it.sentTelegram;
      totalSentEmail += it.sentEmail;
      totalFailed += it.failedTelegram + it.failedEmail;
      if (it.status === "completed") completed++;
    }
    return { totalSentTg, totalSentEmail, totalFailed, completed };
  }, [items]);

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HistoryStatCard icon={HistoryIcon} label="Всего рассылок" value={total} colorClass="bg-muted border-border text-primary" />
        <HistoryStatCard icon={MessageSquare} label="Доставлено TG" value={stats.totalSentTg} colorClass="bg-muted border-sky-500/30 text-sky-500 dark:text-sky-400" />
        <HistoryStatCard icon={Mail} label="Доставлено Email" value={stats.totalSentEmail} colorClass="bg-muted border-cyan-500/30 text-cyan-500 dark:text-cyan-400" />
        <HistoryStatCard icon={AlertTriangle} label="Ошибок доставки" value={stats.totalFailed} colorClass="bg-muted border-red-500/30 text-red-500 dark:text-red-400" />
      </div>

      <Card className="bg-card border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 sm:p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-[13.5px] font-bold">История рассылок</h2>
              <p className="text-xs text-muted-foreground">Последние {Math.min(items.length, 100)} записей</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl">
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Обновить
          </Button>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Megaphone className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-sm font-medium">Рассылок ещё не было</p>
            <p className="text-xs text-muted-foreground">Запусти первую — она появится здесь</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it) => {
              const b = statusBadge(it.status);
              const ch = channelMetaIcon(it.channel);
              const ChIcon = ch.Icon;
              const tgLine = it.totalTelegram > 0
                ? `${it.sentTelegram}/${it.totalTelegram}${it.failedTelegram ? ` · ${it.failedTelegram} fail` : ""}`
                : null;
              const emailLine = it.totalEmail > 0
                ? `${it.sentEmail}/${it.totalEmail}${it.failedEmail ? ` · ${it.failedEmail} fail` : ""}`
                : null;
              const preview = it.message.length > 100 ? it.message.slice(0, 100) + "…" : it.message;
              return (
                <button
                  key={it.id}
                  onClick={() => setDetail(it)}
                  className="w-full text-left p-4 sm:p-4 hover:bg-white/[0.03] transition-colors flex flex-col sm:flex-row gap-4 sm:items-center group"
                >
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", ch.cls)}>
                    <ChIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border", b.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", b.dot)} />
                        {b.text}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{channelLabel(it.channel)}</span>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtMsk(it.startedAt)}</span>
                    </div>
                    <p className="text-sm text-foreground/90 line-clamp-2 break-words pr-2">{preview}</p>
                    <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                      {tgLine && (
                        <span className="inline-flex items-center gap-1 bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 py-0.5 rounded-md border border-sky-500/20">
                          <MessageSquare className="h-3 w-3" /> {tgLine}
                        </span>
                      )}
                      {emailLine && (
                        <span className="inline-flex items-center gap-1 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-md border border-cyan-500/20">
                          <Mail className="h-3 w-3" /> {emailLine}
                        </span>
                      )}
                      {it.attachmentName && (
                        <span className="inline-flex items-center gap-1 bg-foreground/5 text-muted-foreground px-2 py-0.5 rounded-md border border-border">
                          <Paperclip className="h-3 w-3" /> {it.attachmentName}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-bold">
              <HistoryIcon className="h-5 w-5 text-primary" />
              Рассылка
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">Запущена: {fmtMsk(detail.startedAt)}{detail.finishedAt ? ` · завершена: ${fmtMsk(detail.finishedAt)}` : ""}</p>

              <div className="grid grid-cols-2 gap-3">
                <DetailTile label="Канал" value={channelLabel(detail.channel)} />
                <DetailTile label="Статус" value={statusBadge(detail.status).text} />
                {detail.totalTelegram > 0 && (
                  <DetailTile label="Telegram" value={`${detail.sentTelegram} / ${detail.totalTelegram}${detail.failedTelegram ? ` · ${detail.failedTelegram} fail` : ""}`} mono />
                )}
                {detail.totalEmail > 0 && (
                  <DetailTile label="Email" value={`${detail.sentEmail} / ${detail.totalEmail}${detail.failedEmail ? ` · ${detail.failedEmail} fail` : ""}`} mono />
                )}
              </div>

              {detail.subject && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Тема (email)</p>
                  <p className="text-sm">{detail.subject}</p>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Сообщение</p>
                <pre className="whitespace-pre-wrap break-words text-sm p-4 rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] max-h-72 overflow-y-auto leading-relaxed">{detail.message}</pre>
              </div>

              {(detail.buttonText || detail.buttonUrl) && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Кнопка</p>
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
                    <p className="font-medium">{detail.buttonText}</p>
                    <code className="text-muted-foreground break-all">{detail.buttonUrl}</code>
                  </div>
                </div>
              )}

              {detail.attachmentName && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Вложение</p>
                  <p className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-foreground/5 border border-border"><Paperclip className="h-3 w-3" /> {detail.attachmentName}</p>
                </div>
              )}

              {detail.error && (
                <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Фатальная ошибка</p>
                    <p className="mt-0.5">{detail.error}</p>
                  </div>
                </div>
              )}

              {detail.errors && detail.errors.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Ошибки доставки ({detail.errors.length})</p>
                  <pre className="whitespace-pre-wrap text-xs p-3 rounded-xl border bg-red-500/5 border-red-500/20 max-h-48 overflow-y-auto text-red-600 dark:text-red-400">{detail.errors.join("\n")}</pre>
                </div>
              )}

              {/* 25.05.2026, WolfVPN — скачать CSV всех получателей этой рассылки. */}
              {detail.sentTelegram > 0 && (
                <div className="flex justify-start">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadRecipients}
                    disabled={recipientsLoading}
                    className="rounded-xl"
                  >
                    {recipientsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                    Скачать получателей ({detail.sentTelegram.toLocaleString("ru-RU")}) — CSV
                  </Button>
                </div>
              )}

              {/* 25.05.2026, WolfVPN — кнопка «Остановить» для running рассылок прямо из истории.
                  Если job живой в памяти api — graceful cancel. Если зомби после рестарта —
                  бэк помечает как cancelled в DB (zombie_cleanup). */}
              {detail.status === "running" && (
                <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/[0.05] space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">Остановить рассылку</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Прервёт активную рассылку между сообщениями. Если рассылка зависла после рестарта api («зомби») — будет помечена как cancelled.
                    После остановки её можно <b>возобновить</b> с того же места через кнопку ниже (появится).
                  </p>
                  <Button
                    onClick={handleStop}
                    disabled={stopLoading}
                    variant="destructive"
                    className="rounded-xl"
                  >
                    {stopLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                    Остановить
                  </Button>
                  {stopError && (
                    <p className="text-xs text-red-500 mt-2 flex gap-1.5 items-start">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {stopError}
                    </p>
                  )}
                </div>
              )}

              {/* 25.05.2026, WolfVPN — кнопка «Возобновить» для cancelled/error.
                  Skip уже отправленных через broadcast_sent_log  почти 0 дублей. */}
              {(detail.status === "cancelled" || detail.status === "error") && detail.channel !== "email" && (
                <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] space-y-3">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Возобновить рассылку</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Продолжит с того места где остановилась — {detail.sentTelegram} уже отправленных {detail.totalTelegram > 0 ? `из ${detail.totalTelegram}` : ""} получателей будут пропущены автоматически.
                    {detail.attachmentName && (
                      <span className="block mt-1"> Файл-вложение нужно переаплоадить (бинарь не хранится в БД): <code className="text-foreground">{detail.attachmentName}</code></span>
                    )}
                  </p>
                  <input
                    ref={resumeFileInputRef}
                    type="file"
                    accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                    className="hidden"
                    onChange={(e) => handleResume(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex gap-2">
                    {detail.attachmentName ? (
                      <Button
                        onClick={() => resumeFileInputRef.current?.click()}
                        disabled={resumeLoading}
                        className="rounded-xl bg-emerald-500 hover:bg-emerald-600"
                      >
                        {resumeLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Paperclip className="h-4 w-4 mr-2" />}
                        Загрузить файл и возобновить
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleResume(null)}
                        disabled={resumeLoading}
                        className="rounded-xl bg-emerald-500 hover:bg-emerald-600"
                      >
                        {resumeLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                        Возобновить
                      </Button>
                    )}
                  </div>
                  {resumeError && (
                    <p className="text-xs text-red-500 mt-2 flex gap-1.5 items-start">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {resumeError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryStatCard({ icon: Icon, label, value, colorClass }: { icon: typeof Send; label: string; value: number; colorClass: string }) {
  return (
    <Card className={cn("p-4 rounded-xl border ", colorClass)}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide opacity-80 font-medium">{label}</p>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <p className="text-[13.5px] font-bold mt-1.5">{value.toLocaleString("ru-RU")}</p>
    </Card>
  );
}

function DetailTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02]">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-medium mt-0.5", mono && "font-mono text-sm")}>{value}</p>
    </div>
  );
}
