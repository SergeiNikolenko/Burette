export type PdfViewport = {
  width: number;
  height: number;
};

export type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

export type PdfPageProxy = {
  rotate?: number;
  getViewport: (options: { scale: number; rotation?: number }) => PdfViewport;
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    transform?: number[];
  }) => PdfRenderTask;
};

export type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void>;
};

export type PdfjsModule = {
  GlobalWorkerOptions: {
    workerSrc?: string;
  };
  getDocument: (source: string | { data: Uint8Array }) => {
    promise: Promise<PdfDocumentProxy>;
  };
};
