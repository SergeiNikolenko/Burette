import { registerThumbnailTestReset } from "./thumbnail-test-reset";

export interface ThumbnailWorkerMessage {
  id: number;
}

export interface ThumbnailWorkerClientOptions<Request, Response> {
  createWorker: () => Worker;
  resolve: (response: Response) => unknown;
  reject: (response: Response) => string | Error;
}

export interface ThumbnailWorkerRequest<Request> {
  request: Request;
  transfer?: Transferable[];
}

export interface ThumbnailWorkerClient<Request, Response> {
  request<T = unknown>(input: ThumbnailWorkerRequest<Request>): Promise<T>;
  reset(): void;
  pendingCount(): number;
}

export function createThumbnailWorkerClient<
  Request extends ThumbnailWorkerMessage,
  Response extends ThumbnailWorkerMessage,
>({
  createWorker,
  resolve,
  reject,
}: ThumbnailWorkerClientOptions<Request, Response>): ThumbnailWorkerClient<
  Omit<Request, "id">,
  Response
> {
  let worker: Worker | null = null;
  let requestId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const getWorker = () => {
    if (!worker) {
      const nextWorker = createWorker();
      worker = nextWorker;
      nextWorker.onmessage = (event: MessageEvent<Response>) => {
        if (worker !== nextWorker) return;
        const response = event.data;
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        try {
          const value = resolve(response);
          if (value !== undefined) entry.resolve(value);
          else entry.reject(toWorkerError(reject(response)));
        } catch (error) {
          entry.reject(toWorkerError(error));
        }
      };
      nextWorker.onerror = (event) => {
        if (worker !== nextWorker) return;
        nextWorker.terminate();
        worker = null;
        requestId = 0;
        rejectPendingRequests(
          event.error instanceof Error
            ? event.error
            : new Error(event.message || "Thumbnail worker failed."),
        );
      };
    }
    return worker;
  };

  const rejectPendingRequests = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const reset = () => {
    worker?.terminate();
    worker = null;
    requestId = 0;
    rejectPendingRequests(new Error("Thumbnail worker reset."));
  };

  const client: ThumbnailWorkerClient<Omit<Request, "id">, Response> = {
    request<T = unknown>(
      input: ThumbnailWorkerRequest<Omit<Request, "id">>,
    ): Promise<T> {
      const { request, transfer } = input;
      const id = ++requestId;
      return new Promise<T>((resolveRequest, rejectRequest) => {
        pending.set(id, {
          resolve: (value) => resolveRequest(value as T),
          reject: rejectRequest,
        });
        try {
          getWorker().postMessage({ id, ...request }, transfer ?? []);
        } catch (error) {
          pending.delete(id);
          rejectRequest(toWorkerError(error));
        }
      });
    },
    reset,
    pendingCount: () => pending.size,
  };

  registerThumbnailTestReset(reset);

  return client;
}

function toWorkerError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error || "Thumbnail worker failed."));
}
