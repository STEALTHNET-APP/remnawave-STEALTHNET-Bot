import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import { canvasPng, qrImage, saveDownload } from "@/lib/qr-download";

export function CopyLinkButton({ url, className, showLabel = false }: { url: string; className?: string; showLabel?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setCopied(false); }, [url]);
  const label = t(copied ? "subscriptionLink.copied" : "subscriptionLink.copy");
  return <>
    <Button type="button" variant="outline" size={showLabel ? "default" : "icon"} className={className} disabled={busy || !url} aria-label={label} title={label} onClick={async () => {
      setBusy(true);
      try {
        await copyText(url);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2500);
      } catch { setManual(true); } finally { setBusy(false); }
    }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{showLabel && label}<span className="sr-only" role="status">{copied ? label : ""}</span></Button>
    <Dialog open={manual} onOpenChange={setManual}>
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-sm">
        <DialogHeader><DialogTitle>{t("subscriptionLink.copy")}</DialogTitle><DialogDescription>{t("subscriptionLink.manual")}</DialogDescription></DialogHeader>
        <textarea readOnly value={url} aria-label={t("subscriptionLink.url")} className="w-full min-h-28 break-all rounded-lg border bg-background p-3 text-base" onFocus={e => e.currentTarget.select()} />
      </DialogContent>
    </Dialog>
  </>;
}

export function SubscriptionQrButton({ url, name, className }: { url: string; name?: string; className?: string }) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!url) return null;
  const title = name || t("subscriptionLink.title");
  return <Dialog onOpenChange={() => setError(false)}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="icon" className={className} aria-label={t("subscriptionLink.qr")} title={t("subscriptionLink.qr")}><QrCode className="h-4 w-4" /></Button></DialogTrigger>
    <DialogContent className="w-[calc(100%_-_2rem)] max-w-sm max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t("subscriptionLink.scan")}</DialogDescription></DialogHeader>
      <QRCodeSVG ref={svg} value={url} size={1024} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" className="mx-auto h-auto w-full max-w-[280px]" />
      <p className="break-all select-all text-xs text-muted-foreground">{url}</p>
      <div className="flex flex-wrap gap-2"><CopyLinkButton url={url} showLabel className="flex-1 gap-2" /><Button variant="outline" disabled={busy} className="gap-2" onClick={async () => {
        if (!svg.current || busy) return;
        setBusy(true); setError(false);
        try {
          const image = await qrImage(svg.current, 1024);
          const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
          const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unavailable");
          ctx.drawImage(image, 0, 0, 1024, 1024);
          saveDownload(await canvasPng(canvas), "subscription-qr.png");
        } catch { setError(true); } finally { setBusy(false); }
      }}><Download className="h-4 w-4" />PNG</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{t("referralQr.failed")}</p>}
    </DialogContent>
  </Dialog>;
}
