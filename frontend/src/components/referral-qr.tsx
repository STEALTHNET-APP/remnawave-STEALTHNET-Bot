import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePublicConfig } from "@/lib/public-config";
import { buildReferralLinks, type ReferralLink } from "@/lib/referral-links";
import { canvasPng, qrImage, saveDownload } from "@/lib/qr-download";

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
        <ReferralPrintButton code={code} links={links} />
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
    <ReferralPrintButton code={code} links={links} />
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

export function ReferralPrintButton({ code, links }: { code: string; links: ReferralLink[] }) {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const printable = links.filter(link => link.url).slice(0, 2);
  if (!code || !printable.length) return null;
  return <div className="space-y-2">
    <div hidden ref={root}>{printable.map(link => <QRCodeSVG key={link.kind} value={link.url} size={900} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" />)}</div>
    <Button type="button" variant="outline" className="w-full gap-2 whitespace-normal h-auto min-h-10" disabled={busy || !config} onClick={async () => {
      if (!root.current || !config || busy) return;
      setBusy(true); setFailed(false);
      try {
        const canvas = document.createElement("canvas"); canvas.width = 2480; canvas.height = 1754;
        const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unavailable");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (config.logo) {
          const logo = new Image(); logo.crossOrigin = "anonymous";
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(() => reject(new Error("Logo timeout")), 3000);
              logo.onload = () => { clearTimeout(timer); resolve(); };
              logo.onerror = () => { clearTimeout(timer); reject(new Error("Logo unavailable")); };
              logo.src = config.logo!;
            });
            const scale = Math.min(110 / logo.width, 110 / logo.height);
            ctx.drawImage(logo, 1240 - logo.width * scale / 2, 30, logo.width * scale, logo.height * scale);
          } catch {}
        }
        ctx.fillStyle = "#111111"; ctx.textAlign = "center";
        ctx.font = "bold 88px Arial, sans-serif";
        ctx.fillText(config.serviceName || "STEALTHNET", 1240, 210, 2200);
        const svgs = Array.from(root.current.querySelectorAll("svg"));
        for (let i = 0; i < printable.length; i++) {
          const image = await qrImage(svgs[i], 900);
          const center = printable.length === 1 ? 1240 : 640 + i * 1200;
          ctx.drawImage(image, center - 450, 370, 900, 900);
          ctx.font = "bold 60px Arial, sans-serif";
          ctx.fillText(t(printable[i].kind === "bot" ? "referralQr.printBot" : "referralQr.site"), center, 1370, 1050);
        }
        ctx.font = "48px Arial, sans-serif";
        ctx.fillText(t("referralQr.printCode", { code }), 1240, 1590, 2200);
        saveDownload(await canvasPng(canvas), `ref-${code.replace(/[^a-zA-Z0-9_-]/g, "_")}-print.png`);
      } catch { setFailed(true); } finally { setBusy(false); }
    }}><Download className="h-4 w-4 shrink-0" />{t("referralQr.printDownload")}</Button>
    {failed && <p role="alert" className="text-sm text-destructive">{t("referralQr.failed")}</p>}
  </div>;
}

export function AdminReferralQr({ code }: { code: string }) {
  const config = usePublicConfig();
  if (!config) return null;
  const links = buildReferralLinks(code, config.publicAppUrl || window.location.origin, config.telegramBotUsername);
  return <ReferralQrButton code={code} links={links} />;
}
