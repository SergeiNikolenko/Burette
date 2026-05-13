const DEFAULT_DEV_INSTANCE_NAME = "Dev Test";
const DEV_INSTANCE_QUERY_PARAM = "instance";

function viteDev() {
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
}

function viteInstanceName() {
  return (import.meta as unknown as { env?: { VITE_BURRETE_INSTANCE_NAME?: string } }).env
    ?.VITE_BURRETE_INSTANCE_NAME;
}

function queryInstanceName() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(DEV_INSTANCE_QUERY_PARAM);
}

function normalizeInstanceName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function devInstanceName() {
  return (
    normalizeInstanceName(queryInstanceName()) ??
    normalizeInstanceName(viteInstanceName()) ??
    DEFAULT_DEV_INSTANCE_NAME
  );
}

export function devInstanceTitle() {
  return devInstanceTitleFor(devInstanceName());
}

export function devInstanceBadge() {
  return devInstanceBadgeFor(devInstanceName());
}

export function devInstanceTitleFor(name: string) {
  return "Burrete Dev: " + name;
}

export function devInstanceBadgeFor(name: string) {
  return "Dev: " + name;
}

export function isDevInstance() {
  if (viteDev()) return true;
  if (typeof window === "undefined") return false;
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}
