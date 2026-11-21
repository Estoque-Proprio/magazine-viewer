// page-flip 2.0.7 não publica tipos. Só o que o visualizador usa.
declare module "page-flip/dist/js/page-flip.module.js" {
  export type FlipCorner = "top" | "bottom";
  export type Orientation = "portrait" | "landscape";
  export type FlippingState = "user_fold" | "fold_corner" | "flipping" | "read";

  export interface FlipSetting {
    startPage: number;
    size: "fixed" | "stretch";
    width: number;
    height: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    drawShadow: boolean;
    flippingTime: number;
    usePortrait: boolean;
    startZIndex: number;
    autoSize: boolean;
    maxShadowOpacity: number;
    showCover: boolean;
    mobileScrollSupport: boolean;
    clickEventForward: boolean;
    useMouseEvents: boolean;
    swipeDistance: number;
    showPageCorners: boolean;
    disableFlipByClick: boolean;
  }

  export interface PageRect {
    left: number;
    top: number;
    width: number;
    height: number;
    pageWidth: number;
  }

  export interface FlipEvent<T> {
    data: T;
    object: PageFlip;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: Partial<FlipSetting>);
    loadFromHTML(items: HTMLElement[]): void;
    on(event: "flip", callback: (e: FlipEvent<number>) => void): PageFlip;
    on(event: "changeOrientation", callback: (e: FlipEvent<Orientation>) => void): PageFlip;
    on(event: "changeState", callback: (e: FlipEvent<FlippingState>) => void): PageFlip;
    update(): void;
    destroy(): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;
    flip(page: number, corner?: FlipCorner): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): Orientation;
    getBoundsRect(): PageRect;
    getSettings(): FlipSetting;
    getState(): FlippingState;
  }
}
