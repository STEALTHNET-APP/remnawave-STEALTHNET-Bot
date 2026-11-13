import { useTranslation } from "react-i18next";

export function PasswordHint({ id, minLength }: { id: string; minLength: number }) {
  const { t } = useTranslation();
  return <p id={id} className="text-xs text-muted-foreground">{t("passwordHint", { count: minLength })}</p>;
}
