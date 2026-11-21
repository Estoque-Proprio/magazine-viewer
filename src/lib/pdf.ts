import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CHUNK_SIZE, fetchRange, type PdfPrefetch } from "./prefetch";

export type { PDFDocumentProxy, PDFPageProxy };

type PdfjsLib = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/*
 * Build "legacy" do PDF.js: o build moderno da v6 usa recursos de JavaScript
 * de 2025 em diante (`Map.prototype.getOrInsert`, `Math.sumPrecise`…) e
 * quebraria em celulares que não atualizam o navegador. O legacy traz os
 * polyfills e custa ~15 KB a mais com gzip.
 */
let pdfjs: Promise<PdfjsLib> | null = null;
let workerPort: Worker | null = null;

/** Worker já criado pelo script inline do index.html (sobe junto com o HTML). */
export function adoptWorker(worker: Worker) {
  workerPort ??= worker;
}

/** Baixa o PDF.js e sobe o worker (1,3 MB) ao mesmo tempo, não um depois do outro. */
export function loadPdfjs() {
  if (!pdfjs) {
    workerPort ??= new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    const port = workerPort;
    pdfjs = import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerPort = port;
      return lib;
    });
  }
  return pdfjs;
}

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * Abre o PDF. Com `prefetch` (começo e fim do arquivo já baixados, ver
 * prefetch.ts), o PDF.js não toca a rede para abrir: lê o índice do fim e a
 * primeira página do começo, e os outros pedaços vêm pelo nosso `fetch` com
 * `Range`. Sem ele (servidor sem `Range`), o PDF.js baixa sozinho.
 */
export async function openPdf(url: string, prefetch: PdfPrefetch | null = null) {
  const lib = await loadPdfjs();
  const common = {
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    /*
     * O S3 aceita `Range` com CORS: o PDF.js baixa só os pedaços das páginas
     * pedidas, nunca o arquivo inteiro de fundo (catálogos passam de 40 MB, e
     * o visualizador antigo puxava tudo no plano de dados da cliente).
     * `disableStream` é necessário para o `disableAutoFetch` valer.
     */
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: CHUNK_SIZE,
    enableXfa: false,
  };

  if (prefetch?.complete) return lib.getDocument({ ...common, data: prefetch.head });
  if (prefetch) return lib.getDocument({ ...common, range: createRangeTransport(lib, prefetch) });
  return lib.getDocument({ ...common, url });
}

function createRangeTransport(lib: PdfjsLib, { url, length, head, tail }: PdfPrefetch) {
  const controller = new AbortController();

  class RangeTransport extends lib.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      const stop = Math.min(end, length);
      // Pedaço do fim que já chegou adiantado: responde sem rede.
      if (tail && begin >= tail.start && stop <= tail.start + tail.data.length) {
        const slice = tail.data.slice(begin - tail.start, stop - tail.start);
        queueMicrotask(() => this.onDataRange(begin, slice));
        return;
      }
      fetchRange(url, begin, stop, controller.signal)
        .then((data) => this.onDataRange(begin, data))
        .catch(() => {});
    }
    abort() {
      controller.abort();
    }
  }

  return new RangeTransport(length, head);
}

/** Libera a memória do canvas na hora (o Safari do iPhone tem teto baixo). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Desenha a página num canvas novo, na resolução da tela (até 2x), com teto
 * de pixels. Desenhar num canvas novo e só depois trocar evita piscar.
 */
export async function renderPage(page: PDFPageProxy, cssWidth: number, maxPixels: number, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelado", "AbortError");

  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let scale = (cssWidth * dpr) / base.width;
  const pixels = base.width * base.height * scale * scale;
  if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const task = page.render({ canvas, viewport });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel);
  try {
    await task.promise;
    return canvas;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export type PageLink = {
  /** Posição em % da página, para valer em qualquer tamanho e zoom. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Link externo (produto, WhatsApp…). O PDF.js só preenche com protocolos seguros. */
  href?: string;
  /** Link para outra página do próprio PDF (sumário). */
  dest?: unknown;
  /** Ação nomeada: NextPage, PrevPage, FirstPage, LastPage. */
  action?: string;
};

type LinkAnnotation = {
  subtype?: string;
  rect: number[];
  url?: string;
  dest?: unknown;
  action?: string;
};

export async function getPageLinks(page: PDFPageProxy): Promise<PageLink[]> {
  const annotations = (await page.getAnnotations({ intent: "display" })) as LinkAnnotation[];
  const viewport = page.getViewport({ scale: 1 });

  return annotations
    .filter((a) => a.subtype === "Link" && (a.url || a.dest || a.action))
    .map((a) => {
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
      return {
        left: (Math.min(x1, x2) / viewport.width) * 100,
        top: (Math.min(y1, y2) / viewport.height) * 100,
        width: (Math.abs(x2 - x1) / viewport.width) * 100,
        height: (Math.abs(y2 - y1) / viewport.height) * 100,
        href: a.url,
        dest: a.dest,
        action: a.action,
      };
    })
    .filter((link) => link.width > 0 && link.height > 0);
}

/** Índice (base 0) da página de destino de um link interno, ou null. */
export async function resolveLinkTarget(doc: PDFDocumentProxy, link: PageLink, current: number) {
  switch (link.action) {
    case "NextPage":
      return current + 1;
    case "PrevPage":
      return current - 1;
    case "FirstPage":
      return 0;
    case "LastPage":
      return doc.numPages - 1;
  }

  const explicit = typeof link.dest === "string" ? await doc.getDestination(link.dest) : link.dest;
  if (!Array.isArray(explicit)) return null;
  const [target] = explicit;
  if (Number.isInteger(target)) return target as number;
  if (target && typeof target === "object") return doc.getPageIndex(target as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
  return null;
}

/** O arquivo não existe mais ou não é PDF: não adianta tentar de novo. */
export function isMissingFile(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { name, status } = error as { name?: string; status?: number };
  return name === "InvalidPDFException" || (name === "ResponseException" && (status === 404 || status === 403));
}
