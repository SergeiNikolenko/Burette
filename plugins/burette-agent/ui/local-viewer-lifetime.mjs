/** Host unmount releases the renderer; only explicit close ends the session. */
export function createViewerLifetime({ dispose, clearContext, persist, showClosed, requestTeardown }) {
  let closed = false;
  let timer;
  let closing;
  function finish({ terminal, notifyHost = false }) {
    if (closed) return closing;
    closed = true;
    clearTimeout(timer);
    dispose({ terminal });
    if (terminal) showClosed();
    let deadline;
    closing = Promise.race([
      Promise.allSettled([clearContext(), ...(terminal ? [persist()] : []), ...(notifyHost ? [requestTeardown()] : [])]),
      new Promise(resolve => { deadline = setTimeout(resolve, 1500); }),
    ]).finally(() => clearTimeout(deadline));
    return closing;
  }
  return {
    get closed() { return closed; },
    schedule(callback, delay) {
      if (!closed) timer = setTimeout(callback, delay);
    },
    close({ notifyHost = false } = {}) {
      return finish({ terminal: true, notifyHost });
    },
    detach() { return finish({ terminal: false }); },
  };
}
