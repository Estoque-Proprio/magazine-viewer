import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createApp, META_MARKER } from "./app.mjs";

const WHATSAPP = "WhatsApp/2.23.20.0 A";
const CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

let root;
let dir;
let base;
let server;
let apiCalls = [];
let apiReply = () => ({ status: 200, body: {} });

const fakeFetch = async (url) => {
  apiCalls.push(url);
  const reply = await apiReply(url);
  if (reply.throws) throw new Error("rede caiu");
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
};

const magazine = (overrides = {}) => ({
  title: "Ciclo 04",
  slug: "ciclo-04",
  description: null,
  cover: "https://s3/x.png",
  brand: { name: "Natura", slug: "natura", logo: null },
  ...overrides,
});

before(async () => {
  root = mkdtempSync(join(tmpdir(), "visualizador-"));
  dir = join(root, "dist");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}"); // fora do build: não pode vazar por ../
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><head><title>Catálogo · Revendi</title>
    <meta name="description" content="padrão" />
    ${META_MARKER}
    </head><body></body></html>`,
  );
  const js = "console.log('olá');".repeat(200);
  writeFileSync(join(dir, "assets", "app-abc.js"), js);
  writeFileSync(join(dir, "assets", "app-abc.js.br"), brotliCompressSync(js));
  writeFileSync(join(dir, "assets", "app-abc.js.gz"), gzipSync(js));
  writeFileSync(join(dir, "page-flip.mp3"), Buffer.alloc(1000, 7));

  server = createApp({ distDir: dir, fetchImpl: fakeFetch, botWaitMs: 300, log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (path, headers = {}) => fetch(base + path, { headers });
const ogImage = (html) => html.match(/property="og:image" content="([^"]+)"/)?.[1];

test("robô do WhatsApp recebe título, descrição e o card do site", async () => {
  apiCalls = [];
  apiReply = () => ({ status: 200, body: magazine() });
  const res = await get("/?brand=natura&slug=ciclo-04", { "user-agent": WHATSAPP });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>Ciclo 04 · Natura · Revendi<\/title>/);
  assert.match(html, /property="og:title" content="Ciclo 04 · Natura"/);
  assert.match(html, /Veja e baixe grátis o catálogo Ciclo 04 de Natura na Revendi\./);
  assert.equal(ogImage(html), "https://www.revendi.app/catalogos/natura/ciclo-04/opengraph-image");
  assert.match(html, /property="og:url" content="https:\/\/visualizador\.revendi\.app\/\?brand=natura&amp;slug=ciclo-04"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(html, /content="padrão"/, "descrição padrão sai quando há a do catálogo");
  assert.deepEqual(apiCalls, ["https://site-api.revendi.app/api/magazines/natura/ciclo-04"]);
  assert.ok(!apiCalls.some((u) => u.includes("/download")), "nunca chama /download (conta abertura)");
});

test("pessoa não espera a API: recebe na hora e o cache esquenta para a próxima", async () => {
  apiCalls = [];
  apiReply = async () => {
    await new Promise((r) => setTimeout(r, 150));
    return { status: 200, body: magazine({ title: "Ciclo 05", slug: "ciclo-05" }) };
  };
  const started = Date.now();
  const first = await (await get("/?brand=natura&slug=ciclo-05", { "user-agent": CHROME })).text();
  assert.ok(Date.now() - started < 120, "não esperou os 150 ms da API");
  assert.doesNotMatch(first, /Ciclo 05/, "sem cache: prévia genérica");
  await new Promise((r) => setTimeout(r, 200));
  const second = await (await get("/?brand=natura&slug=ciclo-05", { "user-agent": CHROME })).text();
  assert.match(second, /og:title" content="Ciclo 05 · Natura"/);
  assert.equal(apiCalls.length, 1, "uma chamada só, depois vem do cache");
});

test("texto da API é escapado (sem injeção de HTML)", async () => {
  apiReply = () => ({ status: 200, body: magazine({ title: `Promo "<script>alert(1)</script>`, slug: "x1" }) });
  const html = await (await get("/?brand=natura&slug=x1", { "user-agent": WHATSAPP })).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Promo &quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("brand/slug com caracteres especiais vão codificados para a API e para a imagem", async () => {
  apiCalls = [];
  apiReply = () => ({ status: 200, body: magazine({ slug: "a/b", brand: { name: "Marca", slug: "x y", logo: null } }) });
  const html = await (await get("/?brand=x%20y&slug=a%2Fb", { "user-agent": WHATSAPP })).text();
  assert.equal(apiCalls[0], "https://site-api.revendi.app/api/magazines/x%20y/a%2Fb");
  assert.equal(ogImage(html), "https://www.revendi.app/catalogos/x%20y/a%2Fb/opengraph-image");
});

test("catálogo que não existe: página normal com prévia genérica", async () => {
  apiReply = () => ({ status: 404, body: { message: "não" } });
  const res = await get("/?brand=natura&slug=sumiu", { "user-agent": WHATSAPP });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /og:title" content="Catálogos · Revendi"/);
  assert.equal(ogImage(html), undefined);
});

test("API lenta ou fora do ar: o robô recebe a página no tempo limite, sem prévia", async () => {
  apiReply = () => new Promise(() => {}); // nunca responde
  const slow = createApp({
    distDir: dir,
    botWaitMs: 200,
    log: () => {},
    fetchImpl: (url, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout")))),
  });
  await new Promise((resolve) => slow.listen(0, "127.0.0.1", resolve));
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${slow.address().port}/?brand=a&slug=b`, { headers: { "user-agent": WHATSAPP } });
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 1000);
  slow.close();
});

test("link sem brand/slug e /index.html servem a página", async () => {
  for (const path of ["/", "/index.html?brand=natura&slug=ciclo-04", "/qualquer/caminho"]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
  }
});

test("asset com hash: brotli pronto e cache de um ano", async () => {
  const res = await get("/assets/app-abc.js", { "accept-encoding": "gzip, deflate, br" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-encoding"), "br");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.match(res.headers.get("content-type"), /javascript/);
  assert.equal(await res.text(), "console.log('olá');".repeat(200));
});

test("asset que não existe é 404, nunca o HTML", async () => {
  for (const path of ["/assets/velho-123.js", "/pdfjs/cmaps/X.bcmap", "/robots.txt"]) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test("não sai da pasta do build", async () => {
  for (const path of ["/../package.json", "/%2e%2e/package.json", "/assets/..%2f..%2fpackage.json"]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.notEqual(await res.text(), "{}", path);
  }
});

test("Range no som (Safari exige) e ETag", async () => {
  const res = await get("/page-flip.mp3", { range: "bytes=0-99" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-99/1000");
  assert.equal((await res.arrayBuffer()).byteLength, 100);

  const etag = (await get("/page-flip.mp3")).headers.get("etag");
  assert.equal((await get("/page-flip.mp3", { "if-none-match": etag })).status, 304);
  assert.equal((await get("/page-flip.mp3", { range: "bytes=5000-" })).status, 416);
});

test("healthcheck e métodos", async () => {
  assert.equal(await (await get("/healthz")).text(), "ok");
  assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
});
