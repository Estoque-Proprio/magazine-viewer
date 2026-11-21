import type { CatalogRef } from "./params";

export const API_URL = (import.meta.env.VITE_API_URL || "https://site-api.revendi.app/api").replace(/\/$/, "");

export class NotFoundError extends Error {
  constructor(message = "Não encontramos este catálogo.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export type MagazineInfo = {
  title: string;
  slug: string;
  cover: string | null;
  description: string | null;
  brand: { name: string; slug: string | null; logo: string | null };
};

export function catalogPath({ brand, slug }: CatalogRef) {
  return `/magazines/${encodeURIComponent(brand)}/${encodeURIComponent(slug)}`;
}

/**
 * Só `Accept`: sem `Content-Type` o GET é "simples" e o navegador não faz a
 * requisição de pré-voo (OPTIONS) do CORS, uma ida e volta a menos. O script
 * inline do index.html faz a mesma chamada (ver `earlyFetchPlugin`).
 */
export function request(path: string) {
  return fetch(API_URL + path, { headers: { Accept: "application/json" } });
}

export async function readJson<T>(pending: Promise<Response>): Promise<T> {
  let response: Response;
  try {
    response = await pending;
  } catch {
    throw new Error("Não conseguimos conectar. Confira sua internet e tente de novo.");
  }
  if (response.status === 404) throw new NotFoundError();
  if (!response.ok) throw new Error("O catálogo não carregou agora. Tente de novo em instantes.");
  return response.json() as Promise<T>;
}

/** Título, capa e marca. Só enfeita a tela: se falhar, o catálogo abre igual. */
export function fetchMagazine(ref: CatalogRef, pending = request(catalogPath(ref))) {
  return readJson<MagazineInfo>(pending);
}

/**
 * Endereço do PDF. Atenção: a API soma 1 em `downloads` a cada chamada, e é
 * isso que conta as aberturas do catálogo desde o visualizador antigo. Chamar
 * uma vez por abertura, nunca de novo (nem no botão de baixar).
 */
export async function fetchPdfUrl(ref: CatalogRef, pending = request(`${catalogPath(ref)}/download`)) {
  const { url } = await readJson<{ url?: string | null }>(pending);
  if (!url) throw new NotFoundError("Este catálogo ainda não tem arquivo.");
  return url;
}
