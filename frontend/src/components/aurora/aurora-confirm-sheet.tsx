import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuButton, AuNotice } from "@/components/aurora/aurora-ui";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
}

export function AuroraConfirmSheet({ open, onClose, title, description, confirmLabel, danger, loading, error, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <AuroraSheet
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      footer={
        <div className="space-y-2">
          <AuButton variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel ?? t("aurora.confirm")}
          </AuButton>
          <AuButton variant="ghost" onClick={onClose} disabled={loading}>
            {t("aurora.cancel")}
          </AuButton>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        {danger && (
          <div className="flex items-start gap-2.5 rounded-[16px] border border-amber-500/25 bg-amber-500/10 p-3.5 text-[13px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("aurora.irreversible_hint")}</span>
          </div>
        )}
        {description && <p className="text-[14px] leading-relaxed text-[var(--au-ink)]">{description}</p>}
        {error && <AuNotice tone="error">{error}</AuNotice>}
      </div>
    </AuroraSheet>
  );
}
