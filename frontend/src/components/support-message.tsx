import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function SupportMessage({ support, content, date, children }: { support: boolean; content?: string; date: string; children?: ReactNode }) {
  const { t, i18n } = useTranslation();
  return <div className="support-message" data-author={support ? "support" : "client"}>
    <div className="support-message-meta"><span>{t(support ? "cabinet.support_ui.team" : "cabinet.support_ui.you")}</span><time dateTime={date}>{new Date(date).toLocaleString(i18n.language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>
    <div className="support-message-body">{content && <p>{content}</p>}{children}</div>
  </div>;
}
