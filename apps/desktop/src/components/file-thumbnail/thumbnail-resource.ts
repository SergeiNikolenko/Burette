import { registerThumbnailTestReset } from "./thumbnail-test-reset";

export function useThumbnailResource<T>(promise: Promise<T>): T {
  const record = getThumbnailResourceRecord(promise);
  if (record.status === "pending") throw record.promise;
  if (record.status === "rejected") throw record.error;
  return record.value as T;
}

let thumbnailResourceRecords = new WeakMap<
  Promise<unknown>,
  ThumbnailResourceRecord<unknown>
>();

function getThumbnailResourceRecord<T>(
  promise: Promise<T>,
): ThumbnailResourceRecord<T> {
  const cached = thumbnailResourceRecords.get(promise) as
    | ThumbnailResourceRecord<T>
    | undefined;
  if (cached) return cached;

  const record: ThumbnailResourceRecord<T> = {
    promise,
    status: "pending",
  };
  promise.then(
    (value) => {
      record.status = "resolved";
      record.value = value;
    },
    (error) => {
      record.status = "rejected";
      record.error = error;
    },
  );
  thumbnailResourceRecords.set(promise, record);
  return record;
}

interface ThumbnailResourceRecord<T> {
  promise: Promise<T>;
  status: "pending" | "resolved" | "rejected";
  value?: T;
  error?: unknown;
}

function resetThumbnailResourceRecordsForTests() {
  thumbnailResourceRecords = new WeakMap();
}

registerThumbnailTestReset(resetThumbnailResourceRecordsForTests);
