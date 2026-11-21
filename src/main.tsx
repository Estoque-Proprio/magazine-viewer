import "./styles.css";
// Primeiro: começa a buscar o catálogo e o PDF.js antes de montar a tela.
import "./lib/catalog";
import { createRoot } from "react-dom/client";
import { KitProvider, NotifyHost, ThemeModeProvider } from "@estoque-proprio/brightmoon";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <KitProvider appName="Revendi">
    <ThemeModeProvider storageKey="@visualizador:theme" defaultMode="system">
      <App />
      <NotifyHost />
    </ThemeModeProvider>
  </KitProvider>,
);
