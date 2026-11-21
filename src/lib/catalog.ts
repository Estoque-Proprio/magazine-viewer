import { useEffect, useRef, useState } from "react";
import { fetchMagazine, fetchPdfUrl, NotFoundError, type MagazineInfo } from "./api";
import { adoptWorker, isMissingFile, loadPdfjs, openPdf, type PDFDocumentProxy } from "./pdf";
import { readPrefetch, startPrefetch } from "./prefetch";
import { readCatalogRef, type CatalogRef } from "./params";

/** Deixado pelo script inline do index.html (só no build de produção). */
type EarlyStart = {
  key: string;
  info: Promise<Response>;
  download: Promise<Response>;
  /** Pontas do PDF, pedidas assim que o endereço chegou (ver prefetch.ts). */
  pdf: Promise<ReturnType<typeof startPrefetch> | null>;
  worker?: Worker;
};
declare global {
  interface Window {
    __catalogEarly?: EarlyStart;
  }
}

export type Catalog = {
  doc: PDFDocumentProxy;
  numPages: number;
  /** Largura / altura da primeira página: o formato do livro. */
  ratio: number;
};

export const catalogRef = readCatalogRef();

/*
 * A rede começa o quanto antes, tudo em paralelo: dados do catálogo, endereço
 * do PDF, o worker e o próprio PDF.js. Em produção o script inline do HTML já
 * disparou as chamadas e o worker antes deste arquivo chegar; aqui só se
 * aproveita o que ele começou (ou começa agora, no `npm run dev`).
 */
const injected = window.__catalogEarly;
const reuse = Boolean(catalogRef && injected && injected.key === `${catalogRef.brand}/${catalogRef.slug}`);
if (reuse && injected?.worker) adoptWorker(injected.worker);

const early = catalogRef
  ? {
      info: fetchMagazine(catalogRef, reuse ? injected!.info : undefined),
      pdfUrl: fetchPdfUrl(catalogRef, reuse ? injected!.download : undefined),
    }
  : null;
early?.info.catch(() => {});
early?.pdfUrl.catch(() => {});
if (catalogRef) {
  loadPdfjs().catch(() => {});
  // O leitor (folhear, zoom, miniaturas) vem num arquivo à parte; já pede.
  import("../Reader").catch(() => {});
}

export function isNotFound(error: unknown) {
  return error instanceof NotFoundError || isMissingFile(error);
}

export function useCatalog(ref: CatalogRef | null) {
  const [info, setInfo] = useState<MagazineInfo | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    (early?.info ?? fetchMagazine(ref)).then((value) => alive && setInfo(value)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [ref]);

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    let task: Awaited<ReturnType<typeof openPdf>> | null = null;
    setError(null);

    (async () => {
      // O endereço só é pedido uma vez (cada chamada conta uma abertura).
      if (!urlRef.current) {
        urlRef.current = await (attempt === 0 && early ? early.pdfUrl : fetchPdfUrl(ref));
      }
      if (!alive) return;
      setPdfUrl(urlRef.current);

      const url = urlRef.current;
      // Pontas do PDF: as que o script inline já pediu ou, senão, agora.
      const injectedPdf = attempt === 0 && reuse ? await injected!.pdf.catch(() => null) : null;
      const prefetch = await readPrefetch(injectedPdf?.url === url ? injectedPdf : startPrefetch(url));
      if (!alive) return;

      task = await openPdf(url, prefetch);
      const doc = await task.promise;
      const first = await doc.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      if (alive) setCatalog({ doc, numPages: doc.numPages, ratio: viewport.width / viewport.height });
    })().catch((reason) => {
      task?.destroy();
      if (alive) setError(reason);
    });

    return () => {
      alive = false;
    };
  }, [ref, attempt]);

  return {
    info,
    pdfUrl,
    catalog,
    error,
    retry: () => setAttempt((n) => n + 1),
  };
}
