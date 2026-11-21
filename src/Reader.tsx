import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton, cn } from "@estoque-proprio/brightmoon";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { MagazineInfo } from "./lib/api";
import type { Catalog } from "./lib/catalog";
import { useFullscreen, useStoredFlag } from "./lib/hooks";
import { readHashPage, writeHashPage } from "./lib/params";
import { resolveLinkTarget, type PageLink } from "./lib/pdf";
import { Flipbook, type FlipController, type ZoomRequest } from "./components/Flipbook";
import { Frame, Toolbar } from "./components/Frame";
import { Thumbnails } from "./components/Thumbnails";
import { ZoomView } from "./components/ZoomView";
import { pageLabel, shortPageLabel } from "./components/pageLabel";

type ReaderProps = { catalog: Catalog; info: MagazineInfo | null; pdfUrl: string | null };

export default function Reader({ catalog, info, pdfUrl }: ReaderProps) {
  const { doc, numPages, ratio } = catalog;
  const flip = useRef<FlipController>(null);
  const [startPage] = useState(() => Math.min(numPages - 1, readHashPage() ?? 0));
  const [visible, setVisible] = useState<number[]>([startPage]);
  const [zoom, setZoom] = useState<ZoomRequest | null>(null);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [sound, setSound] = useStoredFlag("@visualizador:sound", true);
  const fullscreen = useFullscreen();

  const first = visible[0] ?? 0;
  const last = visible[visible.length - 1] ?? 0;
  const canPrev = first > 0;
  const canNext = last < numPages - 1;

  const audio = useMemo(() => {
    const element = new Audio("/page-flip.mp3");
    element.preload = "auto";
    element.volume = 0.6;
    return element;
  }, []);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const playFlip = useCallback(() => {
    if (!soundRef.current) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [audio]);

  const onChange = useCallback((pages: number[]) => {
    setVisible(pages);
    writeHashPage(pages[0]);
  }, []);

  const onInternalLink = useCallback(
    (link: PageLink, page: number) => {
      resolveLinkTarget(doc, link, page)
        .then((target) => {
          if (target !== null && target >= 0 && target < numPages) flip.current?.goTo(target, true);
        })
        .catch(() => {});
    },
    [doc, numPages],
  );

  // Teclado no livro (o zoom e os painéis cuidam do seu).
  useEffect(() => {
    if (zoom || thumbsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") flip.current?.next();
      else if (event.key === "ArrowLeft" || event.key === "PageUp") flip.current?.prev();
      else if (event.key === "Home") flip.current?.goTo(0);
      else if (event.key === "End") flip.current?.goTo(numPages - 1);
      else if (event.key === "+" || event.key === "=") setZoom({ zoom: 1.75, fx: 0.5, fy: 0.3 });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, thumbsOpen, numPages]);

  return (
    <Frame info={info} pdfUrl={pdfUrl}>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-2 sm:inset-x-20 sm:inset-y-4">
          <Flipbook
            doc={doc}
            numPages={numPages}
            ratio={ratio}
            startPage={startPage}
            cover={info?.cover}
            controllerRef={flip}
            onChange={onChange}
            onFlipStart={playFlip}
            onZoomRequest={setZoom}
            onInternalLink={onInternalLink}
          />
        </div>
        <SideArrow side="left" disabled={!canPrev} onClick={() => flip.current?.prev()} />
        <SideArrow side="right" disabled={!canNext} onClick={() => flip.current?.next()} />
      </div>

      <Toolbar
        label={shortPageLabel(visible, numPages)}
        ariaLabel={pageLabel(visible, numPages)}
        canPrev={canPrev}
        canNext={canNext}
        onFirst={() => flip.current?.goTo(0)}
        onPrev={() => flip.current?.prev()}
        onNext={() => flip.current?.next()}
        onZoom={() => setZoom({ zoom: 1.75, fx: 0.5, fy: 0.3 })}
        onPages={() => setThumbsOpen(true)}
        sound={sound}
        onSound={() => setSound(!sound)}
        fullscreen={fullscreen}
      />

      <Thumbnails
        open={thumbsOpen}
        onClose={() => setThumbsOpen(false)}
        doc={doc}
        numPages={numPages}
        ratio={ratio}
        current={visible}
        onSelect={(index) => {
          setThumbsOpen(false);
          flip.current?.goTo(index);
        }}
      />

      {zoom && (
        <ZoomView
          doc={doc}
          numPages={numPages}
          pages={visible}
          ratio={ratio}
          initial={zoom}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={() => flip.current?.goTo(first - 1)}
          onNext={() => flip.current?.goTo(last + 1)}
          onClose={() => setZoom(null)}
          onInternalLink={onInternalLink}
        />
      )}
    </Frame>
  );
}

function SideArrow({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick(): void }) {
  const Icon = side === "left" ? CaretLeft : CaretRight;
  return (
    <IconButton
      label={side === "left" ? "Página anterior" : "Próxima página"}
      variant="tonal"
      tooltipSide={side === "left" ? "right" : "left"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 h-12 w-12 -translate-y-1/2 max-sm:hidden pointer-coarse:hidden disabled:opacity-0",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      <Icon size={22} weight="bold" />
    </IconButton>
  );
}
