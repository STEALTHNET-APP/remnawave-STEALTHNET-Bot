import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePublicConfig } from "@/lib/public-config";
import { buildReferralLinks, type ReferralLink } from "@/lib/referral-links";

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ReferralQrButton({ code, links }: { code: string; links: ReferralLink[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<"site" | "bot">(links[0]?.kind ?? "site");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const link = links.find((item) => item.kind === selected) ?? links[0];
  if (!code || !link) return null;

  async function download(format: "png" | "svg") {
    const svg = svgRef.current;
    if (!svg || !link || busy) return;
    setBusy(true);
    setError(false);
    let imageUrl: string | undefined;
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "1024");
      clone.setAttribute("height", "1024");
      clone.removeAttribute("class");
      const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
      const name = `ref-${code.replace(/[^a-zA-Z0-9_-]/g, "_")}-${link.kind}.${format}`;
      if (format === "svg") {
        saveFile(svgBlob, name);
        return;
      }
      imageUrl = URL.createObjectURL(svgBlob);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("QR image could not be loaded"));
        image.src = imageUrl!;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0, 1024, 1024);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG unavailable")), "image/png"));
      saveFile(png, name);
    } catch {
      setError(true);
    } finally {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={() => setError(false)}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" aria-label={`${t("referralQr.open")} · ${links.length > 1 ? code : t(`referralQr.${link.kind}`)}`}>
          <QrCode className="h-4 w-4" />{t("referralQr.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("referralQr.title")}</DialogTitle>
          <DialogDescription>{t("referralQr.printHint")}</DialogDescription>
        </DialogHeader>
        {links.length > 1 && (
          <div className="flex gap-2" role="group" aria-label={t("referralQr.destination")}>
            {links.map((item) => <Button key={item.kind} type="button" variant={item.kind === link.kind ? "default" : "outline"} className="flex-1" aria-pressed={item.kind === link.kind} disabled={busy} onClick={() => { setSelected(item.kind); setError(false); }}>{t(`referralQr.${item.kind}`)}</Button>)}
          </div>
        )}
        <QRCodeSVG ref={svgRef} value={link.url} size={1024} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" className="mx-auto h-auto w-full max-w-[256px]" title={`${t("referralQr.title")} · ${t(`referralQr.${link.kind}`)}`} />
        <p className="break-all text-center text-xs text-muted-foreground select-all">{link.url}</p>
        <div className="flex flex-wrap gap-2">
          {(["png", "svg"] as const).map((format) => <Button key={format} type="button" variant="outline" className="flex-1 gap-2" disabled={busy} onClick={() => void download(format)}><Download className="h-4 w-4" />{t("referralQr.download", { format: format.toUpperCase() })}</Button>)}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t("referralQr.failed")}</p>}
      </DialogContent>
    </Dialog>
  );
}

export function ReferralQrLinks({ code, links }: { code: string; links: ReferralLink[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return <div className="space-y-3">
    {links.map((link) => <div key={link.kind} className="min-w-0 space-y-2">
      <p className="text-xs font-semibold">{t(`referralQr.${link.kind}`)}</p>
      <p className="break-all font-mono text-xs select-all">{link.url}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={async () => { try { await navigator.clipboard.writeText(link.url); setCopied(link.url); setError(false); } catch { setError(true); } }}><Copy className="h-4 w-4" />{t(copied === link.url ? "referralQr.copied" : "referralQr.copy")}</Button>
        <ReferralQrButton code={code} links={[link]} />
      </div>
    </div>)}
    {error && <p role="alert" className="text-xs text-destructive">{t("referralQr.copyFailed")}</p>}
  </div>;
}

export function AdminReferralQr({ code }: { code: string }) {
  const config = usePublicConfig();
  if (!config) return null;
  const links = buildReferralLinks(code, config.publicAppUrl || window.location.origin, config.telegramBotUsername);
  return <ReferralQrButton code={code} links={links} />;
}
