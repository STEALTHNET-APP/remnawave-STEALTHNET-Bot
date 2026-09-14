/**
 * Logos (variant: strip) — серая полоса логотипов: платёжки, партнёры, сертификаты.
 * Картинки в greyscale + hover full-color для tasteful look.
 */

import { useScrollReveal } from "../scroll-reveal";
import { txt, arr, SECTION_SCROLL_OFFSET } from "../utils";

interface LogoItem {
  imageUrl: string;
  alt?: string;
  href?: string;
}

export function LogosStrip({ block }: { block: import("../types").LandingApiBlock }) {
  const items = arr<LogoItem>(block.props, "items", []);
  const title = txt(block.text, "title");
  const subtitle = txt(block.text, "subtitle");
  const rowRef = useScrollReveal<HTMLDivElement>([items.length], { y: 12, dur: 0.4, stagger: 0 });

  if (items.length === 0) {
    return (
      <section className={`max-w-7xl mx-auto px-4 py-8 md:py-12 ${SECTION_SCROLL_OFFSET}`}>
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-border bg-card dark:bg-card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Добавь логотипы в props.items. Каждый — картинка через загрузчик.
        </div>
      </section>
    );
  }

  return (
    <section className={`max-w-7xl mx-auto px-4 py-8 md:py-12 ${SECTION_SCROLL_OFFSET}`}>
      {title || subtitle ? (
        <div className="mb-6 text-center">
          {title ? <h2 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">{title}</h2> : null}
          {subtitle ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p> : null}
        </div>
      ) : null}

      <div
        ref={rowRef}
        className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6"
      >
        {items.map((logo, idx) => {
          const img = (
            <img
              src={logo.imageUrl}
              alt={logo.alt ?? ""}
              className="h-8 w-auto max-w-[140px] object-contain opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0 md:h-10"
              loading="lazy"
            />
          );
          return logo.href ? (
            <a key={idx} href={logo.href} target="_blank" rel="noreferrer noopener" className="block">
              {img}
            </a>
          ) : (
            <div key={idx}>{img}</div>
          );
        })}
      </div>
    </section>
  );
}
