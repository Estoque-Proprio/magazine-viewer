import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const DEFAULT_API_URL = "https://site-api.revendi.app/api";

/**
 * Pedaço de leitura do PDF (256 KB): o `rangeChunkSize` do PDF.js e o tamanho
 * das pontas pedidas adiantado (src/lib/prefetch.ts e o script inline). Página
 * de catálogo é imagem grande; pedaço pequeno vira muita ida e volta, pedaço
 * grande baixa o que não vai ser visto.
 */
const PDF_CHUNK_SIZE = 256 * 1024;

// Arquivos que o PDF.js busca sob demanda: tabelas de caracteres (CJK),
// fontes padrão (PDFs sem fonte embutida), decodificadores wasm (JPEG 2000,
// JBIG2) e perfis de cor. Saem em /pdfjs/* e só baixam se o PDF pedir.
const pdfjsAssets = ["cmaps", "standard_fonts", "wasm", "iccs"].map((dir) => ({
  src: `node_modules/pdfjs-dist/${dir}/*`,
  dest: `pdfjs/${dir}`,
  rename: { stripBase: true },
}));

/**
 * Abre o PDF sem esperar a última página. Ao abrir um documento, o PDF.js 6
 * carrega a última página só para conferir se o `/Count` da árvore de páginas
 * está certo (`checkLastPage`). Em catálogos de editora a árvore fica no fim
 * do arquivo, em objetos espalhados: são ~10 idas e voltas ao S3, uma depois
 * da outra, antes de poder desenhar a capa (~2,5 s num 4G). O PDF.js 1.9 do
 * visualizador antigo não fazia isso. Sem a conferência, um PDF com `/Count`
 * errado mostraria o número errado de páginas em vez de ser corrigido.
 *
 * Se uma versão nova do PDF.js mudar essa linha, o build falha aqui: confira
 * se a conferência continua no caminho da abertura antes de ajustar.
 */
const CHECK_LAST_PAGE = 'await this.ensureDoc("checkLastPage", [recoveryMode]);';

function pdfjsFastOpen(): Plugin {
  return {
    name: "pdfjs-fast-open",
    transform(code, id) {
      if (!id.includes("pdfjs-dist/legacy/build/pdf.worker.mjs")) return;
      if (!code.includes(CHECK_LAST_PAGE)) {
        throw new Error("pdfjs-fast-open: a linha do checkLastPage mudou no PDF.js; revise o ajuste.");
      }
      return { code: code.replace(CHECK_LAST_PAGE, ""), map: null };
    },
  };
}

/**
 * Começa a rede junto com o HTML, sem esperar o JavaScript do app baixar:
 * - um script inline chama a API (dados e endereço do PDF), sobe o worker
 *   do PDF.js (o arquivo mais pesado), antes até do CSS, e, assim que o
 *   endereço chega, pede o começo e o fim do PDF (src/lib/prefetch.ts);
 * - `modulepreload` do PDF.js e do leitor, que o app só importaria depois.
 * O app aproveita o que foi começado (`window.__catalogEarly`, em
 * src/lib/catalog.ts). No `npm run dev` nada disso entra e o app faz sozinho.
 */
const MARKER = "<!-- catalog-early-start -->";

function earlyStart(apiUrl: string): Plugin {
  let base = "/";
  return {
    name: "catalog-early-start",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const files = Object.values(ctx.bundle ?? {});
        if (files.length === 0) return html.replace(MARKER, ""); // npm run dev

        const worker = files.find((f) => f.type === "asset" && f.fileName.includes("pdf.worker"));
        const preload = files.filter(
          (f) =>
            f.type === "chunk" &&
            (f.facadeModuleId?.includes("pdfjs-dist/legacy/build/pdf.mjs") || f.facadeModuleId?.endsWith("/src/Reader.tsx")),
        );
        if (!worker || preload.length !== 2 || !html.includes(MARKER)) {
          throw new Error("catalog-early-start: não achei o worker, o PDF.js, o leitor ou o marcador no index.html.");
        }

        const script = `(function(){try{
var p=new URLSearchParams(location.search),b=(p.get("brand")||"").trim(),s=(p.get("slug")||"").trim();
if(!b||!s)return;
var u=${JSON.stringify(apiUrl)}+"/magazines/"+encodeURIComponent(b)+"/"+encodeURIComponent(s);
var get=function(x,h){var r=fetch(x,{headers:h});r.catch(function(){});return r};
var json={Accept:"application/json"};
var w;try{w=new Worker(${JSON.stringify(base + worker.fileName)},{type:"module"})}catch(e){}
var d=get(u+"/download",json);
var pdf=d.then(function(r){return r.ok?r.clone().json():null}).then(function(j){
if(!j||!j.url)return null;
return{url:j.url,head:get(j.url,{Range:"bytes=0-${PDF_CHUNK_SIZE - 1}"}),tail:get(j.url,{Range:"bytes=-${PDF_CHUNK_SIZE}"})};
});pdf.catch(function(){});
window.__catalogEarly={key:b+"/"+s,info:get(u,json),download:d,pdf:pdf,worker:w};
}catch(e){}})();`;
        const links = preload
          .map((chunk) => `<link rel="modulepreload" crossorigin href="${base + chunk.fileName}" />`)
          .join("\n    ");

        // O marcador fica antes do <link> do CSS: script inline depois de
        // folha de estilo espera ela carregar, e aqui cada milissegundo conta.
        return html.replace(MARKER, `<script>${script}</script>\n    ${links}`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = (env.VITE_API_URL || process.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/$/, "");

  return {
    plugins: [react(), tailwindcss(), viteStaticCopy({ targets: pdfjsAssets }), pdfjsFastOpen(), earlyStart(apiUrl)],
    worker: {
      format: "es" as const,
      plugins: () => [pdfjsFastOpen()],
    },
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
      __PDF_CHUNK_SIZE__: String(PDF_CHUNK_SIZE),
    },
    build: {
      // O PDF.js passa do limite padrão de aviso (e vem num arquivo à parte).
      chunkSizeWarningLimit: 1500,
    },
  };
});
