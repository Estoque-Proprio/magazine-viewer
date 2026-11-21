import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@estoque-proprio/brightmoon";
import { getPageLinks, releaseCanvas, renderPage, type PageLink, type PDFDocumentProxy } from "../lib/pdf";
import { renderQueue, type JobHandle } from "../lib/queue";

type PageCanvasProps = {
  doc: PDFDocumentProxy;
  /** Base 0. */
  index: number;
  /** Fora da janela de páginas próximas: libera o canvas. */
  active: boolean;
  /** Menor = mais urgente (0 = página na tela). */
  priority: number;
  /** Largura da caixa da página, em px de CSS. */
  cssWidth: number;
  /** Largura / altura da caixa. Página de outro formato fica centralizada dentro. */
  boxRatio: number;
  /** Teto de pixels do canvas (memória). */
  maxPixels: number;
  /** Imagem mostrada até a página desenhar (a capa do catálogo, na página 1). */
  placeholder?: string | null;
  /** Espera antes de redesenhar num tamanho novo (zoom com pinça). */
  debounceMs?: number;
  /** Sem isto, a página não tem links (miniaturas). */
  onInternalLink?: (link: PageLink) => void;
};

/** Mudanças de tamanho dentro desta faixa reaproveitam o desenho atual. */
const KEEP_IF_WITHIN = { grow: 1.15, shrink: 0.6 };

export function PageCanvas({
  doc,
  index,
  active,
  priority,
  cssWidth,
  boxRatio,
  maxPixels,
  placeholder,
  debounceMs = 150,
  onInternalLink,
}: PageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderedWidth = useRef(0);
  const job = useRef<JobHandle | null>(null);
  const priorityRef = useRef(priority);
  priorityRef.current = priority;

  const [pageRatio, setPageRatio] = useState<number | null>(null);
  const [links, setLinks] = useState<PageLink[]>([]);
  const [drawn, setDrawn] = useState(false);

  const ratio = pageRatio ?? boxRatio;
  const fit = ratio > boxRatio ? { w: 1, h: boxRatio / ratio } : { w: ratio / boxRatio, h: 1 };
  const targetWidth = Math.round(cssWidth * fit.w);
  const withLinks = Boolean(onInternalLink);

  // Formato real e links: uma vez, quando a página chega perto.
  useEffect(() => {
    if (!active || pageRatio !== null) return;
    let alive = true;
    doc
      .getPage(index + 1)
      .then(async (page) => {
        const viewport = page.getViewport({ scale: 1 });
        const found = withLinks ? await getPageLinks(page).catch(() => []) : [];
        if (!alive) return;
        setPageRatio(viewport.width / viewport.height);
        setLinks(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, pageRatio, doc, index, withLinks]);

  useEffect(() => {
    job.current?.setPriority(priority);
  }, [priority]);

  // Saiu da janela: devolve a memória.
  useEffect(() => {
    if (active) return;
    job.current?.cancel();
    job.current = null;
    if (canvasRef.current) {
      releaseCanvas(canvasRef.current);
      canvasRef.current.remove();
      canvasRef.current = null;
    }
    renderedWidth.current = 0;
    setDrawn(false);
  }, [active]);

  useEffect(
    () => () => {
      job.current?.cancel();
      if (canvasRef.current) releaseCanvas(canvasRef.current);
    },
    [],
  );

  // Desenha (ou redesenha num tamanho bem diferente).
  useEffect(() => {
    if (!active || targetWidth < 8) return;
    const current = renderedWidth.current;
    if (current && targetWidth <= current * KEEP_IF_WITHIN.grow && targetWidth >= current * KEEP_IF_WITHIN.shrink) {
      return;
    }

    const start = () => {
      job.current?.cancel();
      job.current = renderQueue.add(priorityRef.current, async (signal) => {
        const page = await doc.getPage(index + 1);
        const canvas = await renderPage(page, targetWidth, maxPixels, signal);
        const host = hostRef.current;
        if (signal.aborted || !host) {
          releaseCanvas(canvas);
          return;
        }
        canvas.className = "absolute inset-0 h-full w-full";
        host.appendChild(canvas);
        if (canvasRef.current) {
          releaseCanvas(canvasRef.current);
          canvasRef.current.remove();
        }
        canvasRef.current = canvas;
        renderedWidth.current = targetWidth;
        setDrawn(true);
      });
    };

    // Primeira vez: na hora. Redesenho: espera o tamanho assentar.
    if (!current) {
      start();
      return;
    }
    const timer = window.setTimeout(start, debounceMs);
    return () => window.clearTimeout(timer);
  }, [active, targetWidth, doc, index, maxPixels, debounceMs]);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative" style={{ width: `${fit.w * 100}%`, height: `${fit.h * 100}%` }}>
        {!drawn &&
          (placeholder ? (
            <img src={placeholder} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          ))}
        <div ref={hostRef} className="absolute inset-0" />
        {links.map((link, i) => (
          <a
            key={i}
            href={link.href ?? "#"}
            target={link.href ? "_blank" : undefined}
            rel={link.href ? "noopener noreferrer" : undefined}
            aria-label={link.href ? `Abrir link: ${link.href}` : "Ir para a página do link"}
            onClick={
              link.href
                ? undefined
                : (event) => {
                    event.preventDefault();
                    onInternalLink?.(link);
                  }
            }
            className="absolute rounded-[3px] transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
            style={{ left: `${link.left}%`, top: `${link.top}%`, width: `${link.width}%`, height: `${link.height}%` }}
          />
        ))}
      </div>
    </div>
  );
}
