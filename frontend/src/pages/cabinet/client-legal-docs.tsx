import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { getPublicConfigCached, usePublicConfig } from "@/lib/public-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// issue #112/#127: маршруты /cabinet/documents/privacy, /offer и /refund
// раньше не существовали (ссылка «никуда не вела»). Теперь вместо внутренней
// страницы открываем agreementLink (privacy) / offerLink / refundLink из /public/config.
// Ссылка не настроена — показываем карточку-заглушку вместо битого перехода.

type DocKind = "privacy" | "offer" | "refund";

export function ClientLegalDocsPage({ kind }: { kind: DocKind }) {
  const location = useLocation();
  const config = usePublicConfig();
  const [redirected, setRedirected] = useState(false);

  // Redirect делаем императивно (getPublicConfigCached), а не по config из хука:
  // replace() сносит SPA — повторный рендер после redirect невозможен, и хук
  // здесь нужен только для fallback-карточки, если ссылка не настроена.
  useEffect(() => {
    let alive = true;
    getPublicConfigCached()
      .then((c) => {
        if (!alive) return;
        // agreementLink/offerLink приходят с бэкенда, но в типе PublicConfig их нет
        // (есть только в AdminSettings) — кастуем, как в stealth-profile.tsx.
        const raw = (c as { agreementLink?: string | null; offerLink?: string | null; refundLink?: string | null });
        const link = (kind === "privacy" ? raw.agreementLink : kind === "refund" ? raw.refundLink : raw.offerLink)?.trim() || null;
        if (link) {
          setRedirected(true);
          window.location.replace(link);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [kind, location.pathname]);

  // Пока конфиг грузится (и redirect ещё не сработал) — спиннер вместо карточки.
  const loading = config === null && !redirected;
  const docTitle = kind === "privacy" ? "Политика обработки персональных данных" : kind === "refund" ? "Политика возврата" : "Публичная оферта";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center text-center gap-4 py-10 px-6">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FileText className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold">{docTitle}</h1>
            <p className="text-sm text-muted-foreground">
              Документ не настроен — обратитесь к администратору.
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/cabinet">В кабинет</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
