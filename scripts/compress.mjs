// Depois do `vite build`: grava .br e .gz ao lado dos arquivos de texto do
// dist/. O servidor manda a versão comprimida pronta (sem gastar CPU por
// requisição), e brotli no nível máximo fica ~15–20% menor que o gzip.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const DIST = new URL("../dist/", import.meta.url).pathname;
const COMPRESSIBLE = /\.(js|mjs|css|svg|json|wasm|icc|txt)$/;

let saved = 0;
let count = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (COMPRESSIBLE.test(entry.name) && statSync(full).size > 1024) {
      const data = readFileSync(full);
      const br = brotliCompressSync(data, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
      });
      const gz = gzipSync(data, { level: 9 });
      // Só vale guardar se comprimir de fato.
      if (br.length < data.length * 0.9) writeFileSync(`${full}.br`, br);
      if (gz.length < data.length * 0.9) writeFileSync(`${full}.gz`, gz);
      saved += data.length - br.length;
      count += 1;
    }
  }
};
walk(DIST);
console.log(`compress: ${count} arquivos, ${(saved / 1024 / 1024).toFixed(1)} MB a menos com brotli`);
