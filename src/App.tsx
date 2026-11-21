import { lazy, Suspense, useEffect } from "react";
import { ErrorState, kitErrorMessage } from "@estoque-proprio/brightmoon";
import { catalogRef, isNotFound, useCatalog } from "./lib/catalog";
import { Frame, LoadingBook, NotFound, Toolbar } from "./components/Frame";

// Já pedido em lib/catalog.ts, em paralelo com o PDF; aqui só espera chegar.
const Reader = lazy(() => import("./Reader"));

export function App() {
  const { info, pdfUrl, catalog, error, retry } = useCatalog(catalogRef);

  useEffect(() => {
    if (info) document.title = `${info.title} · ${info.brand.name} · Revendi`;
  }, [info]);

  if (!catalogRef) {
    return (
      <Frame info={null} pdfUrl={null}>
        <NotFound />
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame info={info} pdfUrl={pdfUrl}>
        {isNotFound(error) ? (
          <NotFound />
        ) : (
          <ErrorState
            size="page"
            title="O catálogo não abriu"
            error={new Error(kitErrorMessage(error, "Não foi possível abrir o PDF do catálogo."))}
            onRetry={retry}
            className="h-full"
          />
        )}
      </Frame>
    );
  }

  const loading = (
    <Frame info={info} pdfUrl={pdfUrl} busy>
      <LoadingBook cover={info?.cover ?? null} />
      <Toolbar disabled />
    </Frame>
  );

  if (!catalog) return loading;

  return (
    <Suspense fallback={loading}>
      <Reader catalog={catalog} info={info} pdfUrl={pdfUrl} />
    </Suspense>
  );
}
