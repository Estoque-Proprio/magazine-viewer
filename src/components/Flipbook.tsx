import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { PageFlip } from "page-flip/dist/js/page-flip.module.js";
import type { PageLink, PDFDocumentProxy } from "../lib/pdf";
import { useElementSize, usePrefersReducedMotion } from "../lib/hooks";
import { PageCanvas } from "./PageCanvas";

export type FlipController = {
  next(): void;
  prev(): void;
  /** Índice base 0. `animate` vira a folha; sem ele, pula direto (miniaturas). */
  goTo(index: number, animate?: boolean): void;
};

export type ZoomRequest = { zoom: number; fx: number; fy: number };

type FlipbookProps = {
  doc: PDFDocumentProxy;
  numPages: number;
  /** Largura / altura das páginas (da primeira). */
  ratio: number;
  startPage: number;
  cover?: string | null;
  controllerRef: Ref<FlipController>;
  onChange(visible: number[]): void;
  onFlipStart(): void;
  onZoomRequest(request: ZoomRequest): void;
  onInternalLink(link: PageLink, page: number): void;
};

/** Teto de pixels por página no livro (as do zoom têm o seu). */
const BOOK_MAX_PIXELS = 6_000_000;

/**
 * Duas páginas lado a lado só quando cada uma fica com pelo menos 75% do
 * tamanho que teria sozinha. Computador: duas. Celular em pé: uma.
 */
function prefersSpread(width: number, height: number, ratio: number) {
  const single = Math.min(width, height * ratio);
  const spread = Math.min(width / 2, height * ratio);
  return spread >= single * 0.75;
}

/** Páginas na tela: capa sozinha, depois pares (2-3, 4-5…), como uma revista. */
function visiblePages(index: number, spread: boolean, numPages: number) {
  if (!spread || index === 0) return [index];
  const start = index % 2 === 1 ? index : index - 1;
  return start + 1 < numPages ? [start, start + 1] : [start];
}

export function Flipbook({
  doc,
  numPages,
  ratio,
  startPage,
  cover,
  controllerRef,
  onChange,
  onFlipStart,
  onZoomRequest,
  onInternalLink,
}: FlipbookProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const size = useElementSize(hostRef);
  const reducedMotion = usePrefersReducedMotion();

  const [pageElements] = useState(() =>
    Array.from({ length: numPages }, (_, i) => {
      const element = document.createElement("div");
      element.dataset.page = String(i);
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Página ${i + 1}`);
      return element;
    }),
  );
  const [layout, setLayout] = useState({ spread: false, pageWidth: 0 });
  const [visible, setVisible] = useState<number[]>([startPage]);

  const callbacks = useRef({ onChange, onFlipStart, onZoomRequest });
  callbacks.current = { onChange, onFlipStart, onZoomRequest };

  const sync = () => {
    const flip = flipRef.current;
    if (!flip) return;
    const spread = flip.getOrientation() === "landscape";
    const pageWidth = flip.getBoundsRect()?.pageWidth ?? 0;
    setLayout((current) =>
      current.spread === spread && current.pageWidth === pageWidth ? current : { spread, pageWidth },
    );
    const next = visiblePages(flip.getCurrentPageIndex(), spread, numPages);
    setVisible((current) => (current.join() === next.join() ? current : next));
  };

  /*
   * Orientação. O page-flip decide sozinho por `minWidth` (retrato se o palco
   * tiver menos que 2 × minWidth); a regra daqui é melhor, então o valor é
   * trocado no objeto de configuração dele, que é o mesmo que ele lê.
   */
  const applyOrientation = (flip: PageFlip, width: number, height: number) => {
    flip.getSettings().minWidth = prefersSpread(width, height, ratio) ? 1 : 1e7;
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const flip = new PageFlip(host, {
      width: 1000 * ratio,
      height: 1000,
      size: "stretch",
      minWidth: 1,
      maxWidth: 100_000,
      minHeight: 1,
      maxHeight: 100_000,
      autoSize: false,
      showCover: true,
      usePortrait: true,
      startPage,
      drawShadow: true,
      maxShadowOpacity: 0.35,
      flippingTime: reducedMotion ? 120 : 700,
      mobileScrollSupport: true,
      // Clique no meio da página não vira (o duplo clique é o zoom); vira por
      // canto, arrasto, deslize no celular, setas e teclado.
      disableFlipByClick: true,
      showPageCorners: true,
      clickEventForward: true,
      useMouseEvents: true,
    });
    const rect = host.getBoundingClientRect();
    applyOrientation(flip, rect.width, rect.height);
    flip.loadFromHTML(pageElements);
    // O page-flip põe largura e altura mínimas no palco; aqui quem manda é o CSS.
    host.style.minWidth = "";
    host.style.minHeight = "";

    flip.on("flip", sync);
    flip.on("changeOrientation", sync);
    flip.on("changeState", (event) => {
      if (event.data === "flipping") callbacks.current.onFlipStart();
    });
    flipRef.current = flip;
    sync();

    return () => {
      flipRef.current = null;
      flip.destroy();
    };
    // Monta uma vez por documento (o componente é recriado se o PDF mudar).
  }, []);

  useLayoutEffect(() => {
    const flip = flipRef.current;
    if (!flip || !size.width || !size.height) return;
    applyOrientation(flip, size.width, size.height);
    flip.update();
    sync();
  }, [size.width, size.height]);

  useEffect(() => {
    callbacks.current.onChange(visible);
  }, [visible]);

  useImperativeHandle(
    controllerRef,
    () => ({
      next: () => flipRef.current?.flipNext("bottom"),
      prev: () => flipRef.current?.flipPrev("bottom"),
      goTo: (index, animate = false) => {
        const flip = flipRef.current;
        if (!flip) return;
        const target = Math.max(0, Math.min(numPages - 1, index));
        if (animate) flip.flip(target, "bottom");
        else flip.turnToPage(target);
      },
    }),
    [numPages],
  );

  // Duplo toque / duplo clique, pinça e Ctrl + roda abrem o zoom no ponto.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const focusAt = (x: number, y: number) => {
      const page = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-page]");
      const index = page ? Number(page.dataset.page) : -1;
      const current = visible.indexOf(index);
      if (!page || current < 0) return { fx: 0.5, fy: 0.5 };
      const rect = page.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
      return { fx: (current + px) / visible.length, fy: py };
    };
    const zoomAt = (x: number, y: number, zoom: number) => callbacks.current.onZoomRequest({ zoom, ...focusAt(x, y) });

    let down = { x: 0, y: 0 };
    let lastTap = { time: 0, x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if ((event.target as Element).closest("a, button")) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10) return; // arrastou: é virada
      const now = performance.now();
      const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30;
      if (now - lastTap.time < 320 && near) {
        lastTap = { time: 0, x: 0, y: 0 };
        zoomAt(event.clientX, event.clientY, 2.5);
      } else {
        lastTap = { time: now, x: event.clientX, y: event.clientY };
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0], event.touches[1]];
      zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, 2);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return; // pinça no trackpad chega como Ctrl + roda
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, 1.75);
    };

    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("wheel", onWheel);
    };
  }, [visible]);

  /*
   * Janela de páginas desenhadas: as da tela (prioridade 0), a próxima dupla
   * (aparece durante a virada) e a anterior. O resto não ocupa memória.
   */
  const priorities = useMemo(() => {
    const map = new Map<number, number>();
    const step = layout.spread ? 2 : 1;
    const first = visible[0];
    const last = visible[visible.length - 1];
    visible.forEach((page) => map.set(page, 0));
    for (let k = 1; k <= step + (layout.spread ? 0 : 1); k++) map.set(last + k, k);
    for (let k = 1; k <= step; k++) if (!map.has(first - k)) map.set(first - k, k + 0.5);
    for (const page of map.keys()) if (page < 0 || page >= numPages) map.delete(page);
    return map;
  }, [visible, layout.spread, numPages]);

  return (
    <>
      <div ref={hostRef} className="viewer-book absolute inset-0 select-none" aria-label="Páginas do catálogo" />
      {pageElements.map((element, index) =>
        createPortal(
          <PageCanvas
            doc={doc}
            index={index}
            active={priorities.has(index)}
            priority={priorities.get(index) ?? 99}
            cssWidth={layout.pageWidth}
            boxRatio={ratio}
            maxPixels={BOOK_MAX_PIXELS}
            placeholder={index === 0 ? cover : null}
            onInternalLink={(link) => onInternalLink(link, index)}
          />,
          element,
          String(index),
        ),
      )}
    </>
  );
}
