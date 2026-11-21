import { useEffect, useRef, useState } from "react";
import { cn, Sheet, SheetContent, SidePanel, useMediaQuery } from "@estoque-proprio/brightmoon";
import type { PDFDocumentProxy } from "../lib/pdf";
import { PageCanvas } from "./PageCanvas";

type ThumbnailsProps = {
  open: boolean;
  onClose(): void;
  doc: PDFDocumentProxy;
  numPages: number;
  ratio: number;
  current: number[];
  onSelect(index: number): void;
};

/** Todas as páginas: painel lateral no computador, folha de baixo no celular. */
export function Thumbnails(props: ThumbnailsProps) {
  const wide = useMediaQuery("(min-width: 768px)");
  const grid = <ThumbnailGrid {...props} />;

  if (wide) {
    return (
      <SidePanel open={props.open} onClose={props.onClose} title="Todas as páginas">
        {grid}
      </SidePanel>
    );
  }
  return (
    <Sheet open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent title="Todas as páginas">{grid}</SheetContent>
    </Sheet>
  );
}

function ThumbnailGrid({ doc, numPages, ratio, current, onSelect }: ThumbnailsProps) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-4 px-1 pb-6 md:px-6">
      {Array.from({ length: numPages }, (_, index) => (
        <Thumbnail
          key={index}
          doc={doc}
          index={index}
          ratio={ratio}
          selected={current.includes(index)}
          scrollTo={index === current[0]}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

const THUMB_WIDTH = 160;

function Thumbnail({
  doc,
  index,
  ratio,
  selected,
  scrollTo,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  index: number;
  ratio: number;
  selected: boolean;
  scrollTo: boolean;
  onSelect(index: number): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);

  // Só desenha o que está perto da área visível; longe, devolve a memória.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: "center" });
  }, [scrollTo]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(index)}
      aria-current={selected ? "page" : undefined}
      aria-label={`Ir para a página ${index + 1}`}
      className="group flex flex-col items-center gap-1.5 rounded-xl focus-visible:outline-none"
    >
      <span
        className={cn(
          "relative block w-full overflow-hidden rounded-lg bg-surface-3 transition-[box-shadow,transform] duration-150 group-active:scale-[0.97]",
          "group-focus-visible:ring-2 group-focus-visible:ring-primary",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-page",
        )}
        style={{ aspectRatio: ratio }}
      >
        <PageCanvas
          doc={doc}
          index={index}
          active={near}
          priority={10 + index / 1000}
          cssWidth={THUMB_WIDTH}
          boxRatio={ratio}
          maxPixels={250_000}
        />
      </span>
      <span className={cn("text-caption tabular", selected ? "font-bold text-primary" : "text-fg-secondary")}>
        {index + 1}
      </span>
    </button>
  );
}
