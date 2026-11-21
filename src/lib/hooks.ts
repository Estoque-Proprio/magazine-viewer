import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Tela cheia. No iPhone o Safari não deixa; o botão some. */
export function useFullscreen() {
  const doc = document as FullscreenDocument;
  const supported = Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const read = () => Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  const [active, setActive] = useState(read);

  useEffect(() => {
    const onChange = () => setActive(read());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = useCallback(() => {
    // Navegador pode recusar (ex.: fora de um gesto do usuário): nada a fazer.
    try {
      const root = document.documentElement as FullscreenElement;
      const result = read()
        ? (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)
        : (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
      Promise.resolve(result).catch(() => {});
    } catch {
      // idem
    }
  }, []);

  return { supported, active, toggle };
}

/** Preferência simples do visitante (som ligado…). Sem armazenamento, só não lembra. */
export function useStoredFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Aba anônima ou armazenamento bloqueado.
      }
    },
    [key],
  );
  return [value, update] as const;
}

export function usePrefersReducedMotion() {
  const [reduced] = useState(() => {
    try {
      return matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  return reduced;
}
