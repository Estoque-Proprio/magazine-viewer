import type { ReactNode } from "react";
import { Button, EmptyState, IconButton, Skeleton, TopProgress, notify } from "@estoque-proprio/brightmoon";
import {
  BookOpen,
  CaretDoubleLeft,
  CaretLeft,
  CaretRight,
  CornersIn,
  CornersOut,
  DownloadSimple,
  MagnifyingGlassPlus,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
  SquaresFour,
} from "@phosphor-icons/react";
import type { MagazineInfo } from "../lib/api";
import type { useFullscreen } from "../lib/hooks";
import { catalogRef } from "../lib/catalog";

export const SITE_URL = "https://revendi.app";

/** Moldura: topo com marca, título e ações; o conteúdo ocupa o resto. */
export function Frame({
  info,
  pdfUrl,
  busy = false,
  children,
}: {
  info: MagazineInfo | null;
  pdfUrl: string | null;
  busy?: boolean;
  children: ReactNode;
}) {
  const share = async () => {
    const url = window.location.href;
    const title = info ? `${info.title} · ${info.brand.name}` : "Catálogo";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      notify.success("Link copiado");
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") notify.error("Não foi possível compartilhar");
    }
  };

  const catalogPage =
    catalogRef && `${SITE_URL}/catalogos/${encodeURIComponent(catalogRef.brand)}/${encodeURIComponent(catalogRef.slug)}`;

  return (
    <div className="flex h-full flex-col bg-page">
      <TopProgress busy={busy} />
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)] sm:px-6">
        <a href={catalogPage || SITE_URL} className="shrink-0" aria-label="Revendi">
          <img src="/logo.png" alt="Revendi" width={111} height={20} className="h-5 w-auto sm:h-6" />
        </a>
        <span aria-hidden className="h-6 w-px shrink-0 bg-divider" />
        <div className="min-w-0 flex-1">
          {info ? (
            <>
              <h1 className="truncate text-body font-bold leading-tight text-fg">{info.title}</h1>
              <p className="truncate text-caption text-fg-secondary">{info.brand.name}</p>
            </>
          ) : catalogRef ? (
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          ) : null}
        </div>
        {catalogRef && (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton label="Compartilhar" onClick={share}>
              <ShareNetwork size={20} />
            </IconButton>
            {pdfUrl && (
              <>
                <IconButton
                  label="Baixar PDF"
                  className="sm:hidden"
                  onClick={() => window.open(pdfUrl, "_blank", "noopener")}
                >
                  <DownloadSimple size={20} />
                </IconButton>
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="hidden sm:inline-flex"
                  leading={<DownloadSimple size={18} />}
                >
                  <a href={pdfUrl} target="_blank" rel="noopener">
                    Baixar PDF
                  </a>
                </Button>
              </>
            )}
          </div>
        )}
      </header>
      <main className="relative flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

export function Toolbar({
  disabled = false,
  label = "",
  ariaLabel,
  canPrev = false,
  canNext = false,
  onFirst,
  onPrev,
  onNext,
  onZoom,
  onPages,
  sound,
  onSound,
  fullscreen,
}: {
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  canPrev?: boolean;
  canNext?: boolean;
  onFirst?(): void;
  onPrev?(): void;
  onNext?(): void;
  onZoom?(): void;
  onPages?(): void;
  sound?: boolean;
  onSound?(): void;
  fullscreen?: ReturnType<typeof useFullscreen>;
}) {
  return (
    <nav
      aria-label="Navegação do catálogo"
      className="flex shrink-0 justify-center px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2"
    >
      <div className="flex items-center gap-0.5 rounded-full bg-surface p-1 ring-1 ring-fg/6">
        <IconButton
          label="Primeira página"
          tooltipSide="top"
          className="max-sm:hidden"
          disabled={disabled || !canPrev}
          onClick={onFirst}
        >
          <CaretDoubleLeft size={20} />
        </IconButton>
        <IconButton label="Página anterior" tooltipSide="top" disabled={disabled || !canPrev} onClick={onPrev}>
          <CaretLeft size={20} weight="bold" />
        </IconButton>
        <button
          type="button"
          disabled={disabled}
          onClick={onPages}
          aria-label={ariaLabel ? `${ariaLabel}. Ver todas as páginas` : "Ver todas as páginas"}
          className="min-w-22 rounded-full px-3 py-2 text-center text-caption font-bold text-fg tabular transition-colors hover:bg-surface-2 disabled:opacity-45"
        >
          {disabled ? <Skeleton className="mx-auto h-3.5 w-12" /> : label}
        </button>
        <IconButton label="Próxima página" tooltipSide="top" disabled={disabled || !canNext} onClick={onNext}>
          <CaretRight size={20} weight="bold" />
        </IconButton>

        <span aria-hidden className="mx-1 h-6 w-px bg-divider" />

        <IconButton label="Ampliar" tooltipSide="top" disabled={disabled} onClick={onZoom}>
          <MagnifyingGlassPlus size={20} />
        </IconButton>
        <IconButton label="Todas as páginas" tooltipSide="top" disabled={disabled} onClick={onPages}>
          <SquaresFour size={20} />
        </IconButton>
        <IconButton label={sound ? "Desligar som" : "Ligar som"} tooltipSide="top" disabled={disabled} onClick={onSound}>
          {sound ? <SpeakerHigh size={20} /> : <SpeakerSlash size={20} />}
        </IconButton>
        {fullscreen?.supported && (
          <IconButton
            label={fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}
            tooltipSide="top"
            className="max-sm:hidden"
            disabled={disabled}
            onClick={fullscreen.toggle}
          >
            {fullscreen.active ? <CornersIn size={20} /> : <CornersOut size={20} />}
          </IconButton>
        )}
      </div>
    </nav>
  );
}

/** Enquanto o PDF chega: a capa (vem da API, bem antes) no formato de uma página. */
export function LoadingBook({ cover }: { cover: string | null }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
      <div className="relative aspect-3/4 h-full max-h-full max-w-full overflow-hidden">
        {cover ? (
          <img src={cover} alt="" decoding="async" className="h-full w-full object-contain animate-fade-in" />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <EmptyState
      size="page"
      icon={BookOpen}
      title="Catálogo não encontrado"
      description="Confira se o link está completo ou procure o catálogo no site da Revendi."
      action={
        <Button asChild>
          <a href={`${SITE_URL}/catalogos`}>Ver catálogos</a>
        </Button>
      }
      className="h-full"
    />
  );
}
