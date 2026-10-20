import { markPerformanceOnce } from "./lib/performance";

markPerformanceOnce("app:script-start");

// With the perf trace on (see lib/perf-trace.ts), count React commits through
// the DevTools hook, which React calls on every commit in production builds
// too. It has to exist before React loads, so it lives in this first module.
if (window.__BURETTE_PERF_TRACE__ === true && !("__REACT_DEVTOOLS_GLOBAL_HOOK__" in window)) {
  const counter = { commits: 0 };
  window.__BURETTE_REACT_COMMITS__ = counter;
  Object.assign(window, {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      isDisabled: false,
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onCommitFiberRoot: () => {
        counter.commits++;
      },
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
    },
  });
}
