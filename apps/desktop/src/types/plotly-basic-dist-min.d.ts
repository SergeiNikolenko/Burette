declare module "plotly.js-basic-dist-min" {
  const Plotly: {
    newPlot: (element: HTMLElement, traces: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
    react: (element: HTMLElement, traces: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
    purge: (element: HTMLElement) => void;
  };

  export default Plotly;
}
