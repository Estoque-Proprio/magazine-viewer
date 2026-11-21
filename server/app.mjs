// Servidor do visualizador: serve o build (dist/) e põe no HTML as meta tags
// de prévia (Open Graph) do catálogo do link, para o WhatsApp e afins
// mostrarem capa e título. Sem dependências: só Node 22.

import http from "node:http";
import { readdirSync, readFileSync, statSync, createReadStream } from "node:fs";
import { join, relative, sep, extname } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".icc": "application/vnd.iccprofile",
  ".txt": "text/plain; charset=utf-8",
};

/** Robôs que montam prévia de link. Eles esperam a API; pessoas não. */
const PREVIEW_BOTS =
  /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|pinterest|skypeuripreview|vkshare|redditbot|embedly|iframely|applebot|googlebot|bingbot|snapchat|viber|line\//i;

/** Marcador no index.html onde entram as meta tags. */
export const META_MARKER = "<!-- server:meta -->";

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Todos os arquivos do build, lidos uma vez: só o que está aqui é servido. */
function indexFiles(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!/\.(br|gz)$/.test(entry.name)) {
        const { size, mtimeMs } = statSync(full);
        const has = (suffix) => {
          try {
            return statSync(full + suffix).size;
          } catch {
            return 0;
          }
        };
        const url = "/" + relative(root, full).split(sep).join("/");
        files.set(url, { full, size, br: has(".br"), gz: has(".gz"), etag: `W/"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"` });
      }
    }
  };
  walk(root);
  return files;
}

function cacheControl(path) {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable"; // nome com hash
  if (path.startsWith("/pdfjs/")) return "public, max-age=604800"; // muda só com o PDF.js
  return "public, max-age=86400";
}

/**
 * Dados do catálogo para as meta tags, com cache em memória. Só o endpoint de
 * dados: o `/download` soma uma abertura e nunca é chamado daqui.
 */
function createCatalogCache({ apiUrl, fetchImpl, ttlMs, missTtlMs, maxEntries, timeoutMs, log }) {
  const entries = new Map(); // chave → { value, expires }
  const pending = new Map(); // chave → Promise

  const fetchInfo = async (brand, slug) => {
    const url = `${apiUrl}/magazines/${encodeURIComponent(brand)}/${encodeURIComponent(slug)}`;
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    if (!data || typeof data.title !== "string" || !data.brand || typeof data.brand.name !== "string") return null;
    return data;
  };

  return {
    /** Valor em cache (dados, null = não existe) ou undefined se não tem/venceu. */
    peek(brand, slug) {
      const hit = entries.get(`${brand}/${slug}`);
      return hit && hit.expires > Date.now() ? hit.value : undefined;
    },
    /** Busca (uma por vez por catálogo). Erro de rede vira undefined e não fica em cache. */
    load(brand, slug) {
      const key = `${brand}/${slug}`;
      if (pending.has(key)) return pending.get(key);
      const promise = fetchInfo(brand, slug)
        .then((value) => {
          entries.delete(key);
          entries.set(key, { value, expires: Date.now() + (value ? ttlMs : missTtlMs) });
          if (entries.size > maxEntries) entries.delete(entries.keys().next().value); // o mais antigo
          return value;
        })
        .catch((error) => {
          log(`og: não carregou ${key}: ${error.message}`);
          return undefined;
        })
        .finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
  };
}

function metaTags({ info, brand, slug, publicUrl, siteUrl }) {
  const pageUrl = `${publicUrl}/?brand=${encodeURIComponent(brand)}&slug=${encodeURIComponent(slug)}`;
  if (!info) {
    return {
      title: "Catálogo · Revendi",
      tags: [
        ["property", "og:type", "website"],
        ["property", "og:site_name", "Revendi"],
        ["property", "og:locale", "pt_BR"],
        ["property", "og:title", "Catálogos · Revendi"],
        ["property", "og:description", "Folheie e baixe grátis os catálogos das marcas na Revendi."],
        ["name", "twitter:card", "summary"],
      ],
    };
  }
  const name = `${info.title} · ${info.brand.name}`;
  const description =
    (typeof info.description === "string" && info.description.trim()) ||
    `Veja e baixe grátis o catálogo ${info.title} de ${info.brand.name} na Revendi.`;
  // O card 1200×630 do site (capa, marca e logo). A capa crua do S3 não
  // serve: PNG de vários MB servido como octet-stream, que o WhatsApp ignora.
  const image = `${siteUrl}/catalogos/${encodeURIComponent(info.brand.slug || brand)}/${encodeURIComponent(info.slug || slug)}/opengraph-image`;
  return {
    title: `${name} · Revendi`,
    tags: [
      ["name", "description", description],
      ["property", "og:type", "website"],
      ["property", "og:site_name", "Revendi"],
      ["property", "og:locale", "pt_BR"],
      ["property", "og:url", pageUrl],
      ["property", "og:title", name],
      ["property", "og:description", description],
      ["property", "og:image", image],
      ["property", "og:image:type", "image/png"],
      ["property", "og:image:width", "1200"],
      ["property", "og:image:height", "630"],
      ["property", "og:image:alt", `Capa do catálogo ${info.title} de ${info.brand.name}`],
      ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", name],
      ["name", "twitter:description", description],
      ["name", "twitter:image", image],
    ],
  };
}

export function renderHtml(template, meta) {
  const tags = meta.tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join("\n    ");
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/\s*<meta name="description"[^>]*>/, meta.tags.some(([, key]) => key === "description") ? "" : "$&")
    .replace(META_MARKER, tags);
}

/**
 * @param {object} options
 * @param {string} options.distDir pasta do build
 * @param {string} [options.apiUrl] API do site (sem barra no fim)
 * @param {string} [options.siteUrl] site que gera a imagem de prévia
 * @param {string} [options.publicUrl] endereço público do visualizador
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.botWaitMs] quanto um robô espera a API
 */
export function createApp({
  distDir,
  apiUrl = "https://site-api.revendi.app/api",
  siteUrl = "https://www.revendi.app",
  publicUrl = "https://visualizador.revendi.app",
  fetchImpl = fetch,
  botWaitMs = 3000,
  ttlMs = 10 * 60_000,
  missTtlMs = 60_000,
  maxEntries = 2000,
  log = (message) => console.error(message),
}) {
  const files = indexFiles(distDir);
  const template = readFileSync(join(distDir, "index.html"), "utf8");
  if (!template.includes(META_MARKER)) throw new Error(`index.html sem o marcador ${META_MARKER}`);
  const catalogs = createCatalogCache({ apiUrl, fetchImpl, ttlMs, missTtlMs, maxEntries, timeoutMs: botWaitMs, log });

  const baseHeaders = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };

  async function sendHtml(req, res, url) {
    const brand = url.searchParams.get("brand")?.trim();
    const slug = url.searchParams.get("slug")?.trim();
    let info = null;
    if (brand && slug) {
      info = catalogs.peek(brand, slug);
      if (info === undefined) {
        const loading = catalogs.load(brand, slug);
        // Robô espera (é a prévia); pessoa recebe na hora e o cache esquenta.
        info = PREVIEW_BOTS.test(req.headers["user-agent"] ?? "") ? await loading : undefined;
      }
    }
    const body = renderHtml(template, metaTags({ info: info ?? null, brand, slug, publicUrl, siteUrl }));
    res.writeHead(200, {
      ...baseHeaders,
      "Content-Type": TYPES[".html"],
      "Content-Length": Buffer.byteLength(body),
      // Sempre revalida: pega a versão nova logo após o deploy.
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  function sendFile(req, res, path, file) {
    const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    const headers = { ...baseHeaders, "Content-Type": type, "Cache-Control": cacheControl(path), ETag: file.etag, "Accept-Ranges": "bytes" };

    if (req.headers["if-none-match"] === file.etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    // Versão pré-comprimida no build (brotli > gzip), quando o navegador aceita.
    const accept = String(req.headers["accept-encoding"] ?? "");
    const encoding = file.br && /\bbr\b/.test(accept) ? "br" : file.gz && /\bgzip\b/.test(accept) ? "gzip" : null;
    if ((file.br || file.gz) && !req.headers.range) headers.Vary = "Accept-Encoding";
    if (encoding && !req.headers.range) {
      const suffix = encoding === "br" ? ".br" : ".gz";
      res.writeHead(200, { ...headers, "Content-Encoding": encoding, "Content-Length": encoding === "br" ? file.br : file.gz });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file.full + suffix).pipe(res);
    }

    // Range (o Safari exige para tocar o som da folha).
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (req.headers.range && range && (range[1] || range[2])) {
      let start = range[1] === "" ? file.size - Number(range[2]) : Number(range[1]);
      let end = range[1] === "" || range[2] === "" ? file.size - 1 : Math.min(Number(range[2]), file.size - 1);
      if (start < 0) start = 0;
      if (start > end || start >= file.size) {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${file.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file.full, { start, end }).pipe(res);
    }

    res.writeHead(200, { ...headers, "Content-Length": file.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file.full).pipe(res);
  }

  function notFound(res) {
    res.writeHead(404, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    res.end("Não encontrado");
  }

  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...baseHeaders, Allow: "GET, HEAD" });
      return res.end();
    }

    let url;
    let path;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
      path = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, baseHeaders);
      return res.end();
    }

    if (path === "/healthz") {
      res.writeHead(200, { ...baseHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
      return res.end("ok");
    }

    const file = path === "/index.html" ? null : files.get(path);
    if (file) return sendFile(req, res, path, file);

    // Arquivo que não existe (ex.: asset de um deploy antigo) é 404, nunca o
    // HTML: um .js respondido com HTML quebra com erro confuso no navegador.
    if (path.startsWith("/assets/") || path.startsWith("/pdfjs/") || (extname(path) && path !== "/index.html")) {
      return notFound(res);
    }

    // Qualquer outro caminho é a página (/, /index.html, links antigos).
    sendHtml(req, res, url).catch((error) => {
      log(`erro no HTML: ${error.message}`);
      if (!res.headersSent) res.writeHead(500, baseHeaders);
      res.end();
    });
  });
}
