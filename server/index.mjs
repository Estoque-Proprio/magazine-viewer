import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";

const env = (name, fallback) => (process.env[name] || fallback).replace(/\/$/, "");

const app = createApp({
  distDir: fileURLToPath(new URL("../dist", import.meta.url)),
  apiUrl: env("API_URL", "https://site-api.revendi.app/api"),
  siteUrl: env("SITE_URL", "https://www.revendi.app"),
  publicUrl: env("PUBLIC_URL", "https://visualizador.revendi.app"),
});

const port = Number(process.env.PORT || 80);
app.listen(port, () => console.log(`visualizador: porta ${port}`));

// O Coolify manda SIGTERM no deploy: termina as respostas em andamento e sai.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    app.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
