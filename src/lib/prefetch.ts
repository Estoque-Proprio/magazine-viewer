/*
 * Começo e fim do PDF, pedidos junto com a resposta da API.
 *
 * Para abrir um PDF o PDF.js lê o índice (no fim do arquivo) e depois a
 * primeira página (em geral no começo). Sozinho, ele só começa depois de o
 * PDF.js inteiro chegar, faz um GET completo que cancela ao ver que o
 * servidor aceita `Range` e lê as duas pontas uma depois da outra. Aqui as
 * duas pontas saem em paralelo assim que o endereço chega (em produção, pelo
 * script inline do index.html, antes até do JavaScript do app).
 *
 * O tamanho do pedaço é o mesmo do `rangeChunkSize` do PDF.js: os dados que
 * ele recebe precisam começar em múltiplo do pedaço.
 */
export const CHUNK_SIZE = __PDF_CHUNK_SIZE__;

export type PdfPrefetch = {
  url: string;
  length: number;
  /** Primeiro pedaço do arquivo (ou o arquivo todo, se `complete`). */
  head: Uint8Array;
  complete: boolean;
  /** Último trecho, alinhado ao pedaço do PDF.js. */
  tail: { start: number; data: Uint8Array } | null;
};

/** Começa a baixar as pontas. O script inline do index.html faz o mesmo. */
export function startPrefetch(url: string) {
  const get = (range: string) => fetch(url, { headers: { Range: range } });
  return { url, head: get(`bytes=0-${CHUNK_SIZE - 1}`), tail: get(`bytes=-${CHUNK_SIZE}`) };
}

function parseContentRange(response: Response) {
  const match = response.headers.get("Content-Range")?.match(/bytes (\d+)-(\d+)\/(\d+)/);
  return match ? { start: Number(match[1]), total: Number(match[3]) } : null;
}

/**
 * Lê as pontas. Devolve null se o servidor não aceitou `Range` (aí o PDF.js
 * baixa do jeito dele). Nunca lança: na dúvida, o caminho padrão funciona.
 */
export async function readPrefetch(started: ReturnType<typeof startPrefetch>): Promise<PdfPrefetch | null> {
  try {
    const head = await started.head;
    const headRange = head.status === 206 ? parseContentRange(head) : null;
    if (!headRange || headRange.start !== 0) {
      head.body?.cancel().catch(() => {});
      return null;
    }
    const headData = new Uint8Array(await head.arrayBuffer());
    const length = headRange.total;
    if (headData.length >= length) {
      return { url: started.url, length, head: headData, complete: true, tail: null };
    }

    let tail: PdfPrefetch["tail"] = null;
    try {
      const response = await started.tail;
      const range = response.status === 206 ? parseContentRange(response) : null;
      if (range && range.total === length) {
        const data = new Uint8Array(await response.arrayBuffer());
        const aligned = Math.max(CHUNK_SIZE, Math.ceil(range.start / CHUNK_SIZE) * CHUNK_SIZE);
        if (aligned < length) tail = { start: aligned, data: data.subarray(aligned - range.start) };
      } else {
        response.body?.cancel().catch(() => {});
      }
    } catch {
      // Sem o fim adiantado: o PDF.js pede quando precisar.
    }
    return { url: started.url, length, head: headData, complete: false, tail };
  } catch {
    return null;
  }
}

/** Um pedaço do PDF, com duas novas tentativas se a rede piscar. */
export async function fetchRange(url: string, begin: number, end: number, signal: AbortSignal, attempt = 0): Promise<Uint8Array> {
  try {
    const response = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal });
    if (response.status !== 206) throw new Error(`Range não atendido (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (signal.aborted || attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    return fetchRange(url, begin, end, signal, attempt + 1);
  }
}
