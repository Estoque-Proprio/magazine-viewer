// Worker do PDF.js, empacotado pelo Vite para receber o ajuste do
// vite.config.ts (`pdfjsFastOpen`). O arquivo se inicializa sozinho ao
// carregar num worker.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
