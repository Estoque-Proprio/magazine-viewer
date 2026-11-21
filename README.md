# Visualizador de catálogos

Folheador dos catálogos (PDF) da Revendi em `https://visualizador.revendi.app`.

```
https://visualizador.revendi.app?brand=<marca>&slug=<catálogo>#/magazine/<página>
```

O site e o painel geram esse link: **não mudar o formato**. O `#/magazine/N`
é opcional e é o mesmo do visualizador antigo (links já compartilhados abrem na
página certa). `/index.html?brand=…` também funciona.

## Rodar

```
npm install        # precisa de NPM_TOKEN (GitHub, read:packages) por causa da brightmoon
npm run dev        # http://localhost:5173/?brand=natura&slug=<slug>
npm run build      # typecheck + build em dist/
```

`VITE_API_URL` troca a API (padrão: `https://site-api.revendi.app/api`). Veja `.env.example`.

## Deploy (Coolify)

- Build Pack: **Dockerfile** (na raiz), **não Nixpacks**. Porta **80**.
  O Nixpacks escolhe o Node pelo snapshot do nixpkgs (veio 20.18), e o
  projeto pede Node ≥ 22.13 (Vite 8 e PDF.js 6). Com Node velho o `npm ci`
  falha logo, com `EBADENGINE` (`engine-strict` no `.npmrc`).
- Variável de build: `NPM_TOKEN` (obrigatória). Opcional: `VITE_API_URL`.
- A imagem final é só nginx com os arquivos estáticos (`nginx.conf`): gzip,
  cache de 1 ano nos arquivos com hash, `index.html` sempre revalidado.

## Como funciona

- React 19 + Vite + Tailwind 4, com a **brightmoon** (tema Revendi, claro/escuro do sistema).
- **PDF.js 6** (build `legacy`, para celulares que não atualizam o navegador).
  Desenha só as páginas próximas, na resolução da tela (até 2x) e libera a
  memória das que ficam para trás. Os links do PDF (produtos, sumário) são clicáveis.
- **page-flip** para virar as páginas: uma por vez no celular, duas no computador.
- Zoom em camada própria (pinça, duplo toque, Ctrl + roda, botões), redesenhado em alta resolução.

### Performance

Medido contra o visualizador antigo, no mesmo nginx, com um catálogo de 40 MB e 140 páginas:

| | Antigo | Novo |
| --- | --- | --- |
| 1ª página, computador, rede rápida | 2,5–3,0 s | 1,65 s |
| 1ª página, celular, 4G + CPU 4x mais lenta | 4,3 s | 2,7 s |
| Próxima página ao virar | 40–110 ms | ~10 ms (já desenhada) |
| Baixado do S3 em 20 s parado | 6,5–8,3 MB e continua até o arquivo inteiro | ~1,6 MB e para |

O que faz a diferença:

1. **Tudo começa junto com o HTML.** Um script inline (gerado no build, ver
   `earlyStart` em `vite.config.ts`) chama a API, sobe o worker do PDF.js e,
   assim que o endereço do PDF chega, pede o começo e o fim do arquivo, em
   paralelo e antes até do JavaScript do app.
2. **Só os pedaços necessários.** O S3 aceita `Range`; o PDF.js lê pedaços de
   256 KB das páginas próximas, nunca o arquivo inteiro de fundo.
3. **Abertura sem conferir a última página.** O PDF.js 6 carrega a última
   página ao abrir só para validar a árvore de páginas; nos catálogos isso
   são ~10 idas e voltas em sequência. O build tira essa chamada do worker
   (`pdfjsFastOpen` em `vite.config.ts`) e falha se uma versão nova do PDF.js mudar a linha.
4. **Página da tela primeiro.** A fila de desenho (`src/lib/queue.ts`) não
   deixa página vizinha ou miniatura disputar banda com a que está na tela.

### Contador de aberturas

`GET /magazines/:marca/:slug/download` soma 1 em `downloads` a cada chamada.
O visualizador chama **uma vez por abertura** (como o antigo), então esse
número conta aberturas. O botão "Baixar PDF" não chama de novo.
