import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@estoque-proprio/brightmoon";
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import type { PageLink, PDFDocumentProxy } from "../lib/pdf";
import { useElementSize } from "../lib/hooks";
import { PageCanvas } from "./PageCanvas";
import { pageLabel } from "./pageLabel";

type ZoomViewProps = {
  doc: PDFDocumentProxy;
  numPages: number;
  /** Páginas da tela (uma ou a dupla). */
  pages: number[];
  ratio: number;
  initial: { zoom: number; fx: number; fy: number };
  canPrev: boolean;
  canNext: boolean;
  onPrev(): void;
  onNext(): void;
  onClose(): void;
  onInternalLink(link: PageLink, page: number): void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 1.4;
const PADDING = 16;
/** iPhone recusa canvas acima de ~16,7 milhões de pixels. */
const ZOOM_MAX_PIXELS = 12_000_000;

const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export function ZoomView({
  doc,
  numPages,
  pages,
  ratio,
  initial,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onClose,
  onInternalLink,
}: ZoomViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewport = useElementSize(scrollRef);
  const [zoom, setZoom] = useState(() => clamp(initial.zoom));

  const spreadRatio = ratio * pages.length;
  const fitWidth = viewport.width
    ? Math.max(1, Math.min(viewport.width - PADDING * 2, (viewport.height - PADDING * 2) * spreadRatio))
    : 0;
  const contentWidth = fitWidth * zoom;
  const contentHeight = contentWidth / spreadRatio;
  const wrapWidth = Math.max(viewport.width, contentWidth + PADDING * 2);
  const wrapHeight = Math.max(viewport.height, contentHeight + PADDING * 2);
  const offsetX = (wrapWidth - contentWidth) / 2;
  const offsetY = (wrapHeight - contentHeight) / 2;

  // Valores atuais para os gestos, sem recriar os ouvintes a cada quadro.
  const live = useRef({ zoom, contentWidth, contentHeight, offsetX, offsetY });
  live.current = { zoom, contentWidth, contentHeight, offsetX, offsetY };

  /*
   * Ponto que deve ficar parado durante o zoom: posição no conteúdo (0–1) e
   * onde ele está na tela. Aplicado depois do novo tamanho, antes de pintar.
   */
  const anchor = useRef<{ fx: number; fy: number; ax: number; ay: number } | null>({
    fx: initial.fx,
    fy: initial.fy,
    ax: NaN,
    ay: NaN,
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const target = anchor.current;
    if (!el || !target || !contentWidth) return;
    const ax = Number.isNaN(target.ax) ? el.clientWidth / 2 : target.ax;
    const ay = Number.isNaN(target.ay) ? el.clientHeight / 2 : target.ay;
    el.scrollLeft = target.fx * contentWidth + offsetX - ax;
    el.scrollTop = target.fy * contentHeight + offsetY - ay;
    anchor.current = null;
  }, [contentWidth, contentHeight, offsetX, offsetY]);

  /** Zoom mantendo parado o ponto (ax, ay) da área visível. */
  const zoomTo = useCallback((next: number, ax?: number, ay?: number) => {
    const el = scrollRef.current;
    const now = live.current;
    if (!el || !now.contentWidth) return;
    const clamped = clamp(next);
    if (Math.abs(clamped - now.zoom) < 0.001) return;
    const x = ax ?? el.clientWidth / 2;
    const y = ay ?? el.clientHeight / 2;
    anchor.current = {
      fx: (el.scrollLeft + x - now.offsetX) / now.contentWidth,
      fy: (el.scrollTop + y - now.offsetY) / now.contentHeight,
      ax: x,
      ay: y,
    };
    setZoom(clamped);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Trocou de página com o zoom aberto: começa do topo, centralizado.
  const pagesKey = pages.join();
  const firstPages = useRef(pagesKey);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || firstPages.current === pagesKey) return;
    firstPages.current = pagesKey;
    el.scrollTop = 0;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [pagesKey]);

  // Teclado: Esc fecha, + e − ampliam, setas mudam de página.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomTo(live.current.zoom * STEP);
      else if (event.key === "-") zoomTo(live.current.zoom / STEP);
      else if (event.key === "ArrowLeft" && canPrev && live.current.zoom <= 1.01) onPrev();
      else if (event.key === "ArrowRight" && canNext && live.current.zoom <= 1.01) onNext();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, canPrev, canNext, zoomTo]);

  // Gestos: pinça, duplo toque, Ctrl + roda, arrastar com o mouse.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const local = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };

    let pinch: { distance: number; zoom: number } | null = null;
    let lastTap = { time: 0, x: 0, y: 0 };
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch = { distance: distance(event.touches), zoom: live.current.zoom };
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      if (event.cancelable) event.preventDefault();
      const t = event.touches;
      const mid = local((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
      zoomTo((pinch.zoom * distance(t)) / pinch.distance, mid.x, mid.y);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
      if (event.touches.length > 0 || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const now = performance.now();
      const near = Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 30;
      if (now - lastTap.time < 320 && near) {
        lastTap = { time: 0, x: 0, y: 0 };
        const point = local(touch.clientX, touch.clientY);
        zoomTo(live.current.zoom > 1.05 ? 1 : 2.5, point.x, point.y);
      } else {
        lastTap = { time: now, x: touch.clientX, y: touch.clientY };
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return; // roda normal rola; Ctrl + roda (ou pinça no trackpad) amplia
      event.preventDefault();
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.01)));
      const point = local(event.clientX, event.clientY);
      zoomTo(live.current.zoom * factor, point.x, point.y);
    };

    let drag: { x: number; y: number; left: number; top: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      if ((event.target as Element).closest("a, button")) return;
      drag = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(event.pointerId);
      el.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      el.scrollLeft = drag.left - (event.clientX - drag.x);
      el.scrollTop = drag.top - (event.clientY - drag.y);
    };
    const onPointerUp = () => {
      drag = null;
      el.style.cursor = "";
    };
    const onDoubleClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("a, button")) return;
      const point = local(event.clientX, event.clientY);
      zoomTo(live.current.zoom > 1.05 ? 1 : 2.5, point.x, point.y);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("dblclick", onDoubleClick);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("dblclick", onDoubleClick);
    };
  }, [zoomTo]);

  const pageWidth = contentWidth / pages.length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Zoom: ${pageLabel(pages, numPages)}`}
      className="fixed inset-0 z-40 flex flex-col bg-page animate-fade-in"
    >
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-auto overscroll-contain select-none no-scrollbar"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div className="relative" style={{ width: wrapWidth, height: wrapHeight }}>
          <div
            className="absolute flex"
            style={{ left: offsetX, top: offsetY, width: contentWidth, height: contentHeight }}
          >
            {pages.map((page) => (
              <div key={page} className="relative h-full" style={{ width: pageWidth }}>
                <PageCanvas
                  doc={doc}
                  index={page}
                  active
                  priority={0}
                  cssWidth={pageWidth}
                  boxRatio={ratio}
                  maxPixels={ZOOM_MAX_PIXELS}
                  debounceMs={220}
                  onInternalLink={(link) => onInternalLink(link, page)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3 pt-[max(env(safe-area-inset-top),12px)]">
        <IconButton
          ref={closeRef}
          label="Fechar zoom"
          variant="tonal"
          tooltipSide="left"
          className="pointer-events-auto"
          onClick={onClose}
        >
          <X size={20} weight="bold" />
        </IconButton>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-surface p-1 ring-1 ring-fg/6">
          <IconButton label="Página anterior" tooltipSide="top" disabled={!canPrev} onClick={onPrev}>
            <CaretLeft size={20} weight="bold" />
          </IconButton>
          <IconButton label="Diminuir" tooltipSide="top" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom / STEP)}>
            <MagnifyingGlassMinus size={20} />
          </IconButton>
          <button
            type="button"
            onClick={() => zoomTo(1)}
            className="min-w-16 rounded-full px-2 py-2 text-center text-caption font-bold text-fg-secondary tabular hover:bg-surface-2"
            aria-label="Voltar ao tamanho da tela"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="Ampliar" tooltipSide="top" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * STEP)}>
            <MagnifyingGlassPlus size={20} />
          </IconButton>
          <IconButton label="Próxima página" tooltipSide="top" disabled={!canNext} onClick={onNext}>
            <CaretRight size={20} weight="bold" />
          </IconButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
