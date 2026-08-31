/**
 * AuroraNewTicketSheet — создание обращения в поддержку (дизайн Aurora).
 *
 * Поля те же, что в остальных дизайнах: тема (необязательно, до 500 знаков),
 * сообщение (обязательно, до 4000) и до пяти картинок. Логика отправки
 * повторяет Stealth-версию — отличается только оформление.
 */

import { useRef, useState } from "react";
import { Loader2, AlertCircle, Paperclip, X, ImageIcon } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const MAX_FILES = 5;
const MAX_BODY = 4000;
const MAX_SUBJECT = 500;

export function AuroraNewTicketSheet({ open, onClose, onCreated }: Props) {
  const { state } = useClientAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleClose() {
    setSubject("");
    setBody("");
    setFiles([]);
    setBusy(false);
    setErr(null);
    onClose();
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list)
      .slice(0, MAX_FILES - files.length)
      .filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...arr].slice(0, MAX_FILES));
  }

  async function submit() {
    if (!state.token || !body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createTicket(state.token, {
        subject: subject.trim() || "Без темы",
        message: body.trim(),
        files: files.length > 0 ? files : undefined,
      });
      onCreated?.(r.id);
      handleClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать обращение");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuroraSheet
      open={open}
      onClose={handleClose}
      title="Новое обращение"
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={busy || !body.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[17px] font-bold text-white transition-transform enabled:active:scale-[0.99] disabled:opacity-45"
        >
          {busy && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
          {busy ? "Отправляем…" : "Отправить"}
        </button>
      }
    >
      <div className="space-y-3 pb-1">
        <div>
          <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">
            Тема <span className="font-normal">(необязательно)</span>
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
            placeholder="Например: не подключается на iPhone"
            // 16px — иначе iOS приближает страницу на фокусе
            className="mt-1.5 w-full rounded-[16px] bg-[var(--au-surface)] px-4 py-3.5 text-[16px] outline-none placeholder:text-[var(--au-muted)]"
          />
        </div>

        <div>
          <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">Сообщение</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            rows={5}
            placeholder="Опишите, что случилось — чем подробнее, тем быстрее поможем"
            className="mt-1.5 w-full resize-none rounded-[16px] bg-[var(--au-surface)] px-4 py-3.5 text-[16px] leading-relaxed outline-none placeholder:text-[var(--au-muted)]"
          />
          <p className="px-1 pt-1 text-right text-[12px] tabular-nums text-[var(--au-muted)]">
            {body.length} / {MAX_BODY}
          </p>
        </div>

        {files.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {files.map((f, idx) => (
              <div
                key={idx}
                className="relative flex flex-col items-center gap-1 rounded-[14px] bg-[var(--au-surface)] p-2.5 text-center"
              >
                <ImageIcon className="h-5 w-5 text-[var(--au-muted)]" />
                <p className="w-full truncate text-[11px] text-[var(--au-muted)]">{f.name}</p>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Убрать фото"
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[var(--au-muted)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={files.length >= MAX_FILES}
          className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[var(--au-surface)] px-4 py-3 text-[14px] font-semibold text-[var(--au-muted)] transition-transform enabled:active:scale-[0.98] disabled:opacity-45"
        >
          <Paperclip className="h-[18px] w-[18px]" />
          {files.length > 0 ? `Ещё фото (${files.length}/${MAX_FILES})` : "Прикрепить фото"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            pickFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {err && (
          <div className="flex items-start gap-2 rounded-[16px] bg-[#FDECEA] p-3.5 text-[13px] text-[#8B1D13]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}
      </div>
    </AuroraSheet>
  );
}
