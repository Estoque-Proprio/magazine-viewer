export type CatalogRef = { brand: string; slug: string };

/**
 * O link público é `https://visualizador.revendi.app?brand=<marca>&slug=<catálogo>`
 * (gerado pelo site e pelo painel). Não mudar esse formato.
 */
export function readCatalogRef(search = window.location.search): CatalogRef | null {
  const params = new URLSearchParams(search);
  const brand = params.get("brand")?.trim();
  const slug = params.get("slug")?.trim();
  return brand && slug ? { brand, slug } : null;
}

/**
 * Página no hash. O visualizador antigo escrevia `#/magazine/5`; links
 * compartilhados assim continuam abrindo na página certa. Aceita também `#5`.
 * Devolve o índice (base 0) ou null.
 */
export function readHashPage(hash = window.location.hash): number | null {
  const match = hash.match(/(\d+)\/?$/);
  if (!match) return null;
  const page = Number(match[1]);
  return page >= 1 ? page - 1 : null;
}

/** Grava a página atual no mesmo formato do visualizador antigo, sem criar histórico. */
export function writeHashPage(index: number) {
  const url = new URL(window.location.href);
  url.hash = `/magazine/${index + 1}`;
  window.history.replaceState(window.history.state, "", url);
}
