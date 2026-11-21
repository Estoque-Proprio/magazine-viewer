/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Tamanho do pedaço de leitura do PDF (vite.config.ts). */
declare const __PDF_CHUNK_SIZE__: number;
