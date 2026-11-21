/** "Página 1 de 48" ou "Páginas 2–3 de 48". */
export function pageLabel(pages: number[], numPages: number) {
  if (pages.length === 0) return "";
  if (pages.length === 1) return `Página ${pages[0] + 1} de ${numPages}`;
  return `Páginas ${pages[0] + 1}–${pages[pages.length - 1] + 1} de ${numPages}`;
}

/** Forma curta da barra: "1 / 48" ou "2–3 / 48". */
export function shortPageLabel(pages: number[], numPages: number) {
  if (pages.length === 0) return `– / ${numPages}`;
  const first = pages[0] + 1;
  const last = pages[pages.length - 1] + 1;
  return `${first === last ? first : `${first}–${last}`} / ${numPages}`;
}
