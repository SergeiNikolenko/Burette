type Waiting = { admit: () => void; reject: (error: Error) => void };

// Bound both work and waiting memory. Quick clicks wait their turn; closed
// browser requests leave the queue before any SSH process is acquired.
export class SshRequestQueue {
  private active = 0;
  private waiting = new Set<Waiting>();
  private closed = false;
  acquire(signal: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error("SSH server closed"));
    if (signal.aborted) return Promise.reject(new Error("SSH request cancelled"));
    if (this.active < 3) return Promise.resolve(this.lease());
    if (this.waiting.size >= 200) return Promise.reject(new Error("Too many SSH requests are waiting. Try again shortly."));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.waiting.delete(item);
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      const item: Waiting = {
        admit: () => { cleanup(); resolve(this.lease()); },
        reject: error => { cleanup(); reject(error); },
      };
      const abort = () => item.reject(new Error("SSH request cancelled"));
      const timer = setTimeout(() => item.reject(new Error("SSH request waited too long. Try again.")), 45_000);
      signal.addEventListener("abort", abort, { once: true });
      this.waiting.add(item);
    });
  }
  close() {
    this.closed = true;
    for (const item of this.waiting) item.reject(new Error("SSH server closed"));
  }
  private lease() {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.values().next().value?.admit();
    };
  }
}
