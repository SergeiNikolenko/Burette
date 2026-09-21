import { recordSshStatus } from "./ssh-connection-status";
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

export type SshConnection = { host: string; name: string; enabled: boolean; color?: "cyan" | "blue" | "purple" };
function randomColor(): NonNullable<SshConnection["color"]> { return (["cyan", "blue", "purple"] as const)[crypto.getRandomValues(new Uint32Array(1))[0] % 3]; }
export type SshProject = { id: string; name: string; host: string; root: string; pinned?: boolean; section?: string; openedAt?: number };
export type SshEntry = { name: string; directory: boolean; size: number };
export type SshDirectory = { root: string; path: string; entries: SshEntry[]; truncated: boolean; discovered?: SshDirectory[]; expanded?: string[]; partial?: boolean };
const key = "burette.ssh-projects.v1";
const event = "burette-ssh-projects-changed";
let cachedRaw: string | null | undefined;
let cached: SshProject[] = [];
let cachedConnections: SshConnection[] = [];
function snapshot() {
  const raw = localStorage.getItem(key);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const value: unknown = JSON.parse(raw ?? "[]");
      const record = value && typeof value === "object" ? value as { projects?: unknown; connections?: unknown } : {};
      const projects = Array.isArray(value) ? value : record.projects;
      cached = Array.isArray(projects) ? projects.filter((p): p is SshProject => p && [p.id, p.name, p.host, p.root].every(v => typeof v === "string")).slice(0, 100) : [];
      cachedConnections = Array.isArray(record.connections) ? record.connections.filter((c): c is SshConnection => c && typeof c.host === "string" && typeof c.name === "string" && typeof c.enabled === "boolean").slice(0, 100) : [];
      for (const project of cached) if (!cachedConnections.some(c => c.host === project.host)) cachedConnections.push({ host: project.host, name: project.host, enabled: true });
    } catch { cached = []; cachedConnections = []; }
  }
  return cached;
}
function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(event, callback); window.removeEventListener("storage", callback); };
}
export function useSshProjects() { return useSyncExternalStore(subscribe, snapshot); }
function write(projects: SshProject[], connections: SshConnection[]) {
  if (projects.length > 100 || connections.length > 100) throw new Error("Up to 100 SSH projects and connections can be saved. Remove an unused entry first.");
  localStorage.setItem(key, JSON.stringify({ projects, connections }));
  window.dispatchEvent(new Event(event));
}
function connectionSnapshot() { snapshot(); return cachedConnections; }
export function useSshConnections() { return useSyncExternalStore(subscribe, connectionSnapshot); }
export function saveSshConnection(connection: SshConnection) {
  const previous = connectionSnapshot().find(c => c.host === connection.host);
  write(snapshot(), [...connectionSnapshot().filter(c => c.host !== connection.host), { ...connection, color: connection.color ?? previous?.color ?? randomColor() }]);
}
export function removeSshConnection(host: string) {
  write(snapshot().filter(p => p.host !== host), connectionSnapshot().filter(c => c.host !== host));
}
export function saveSshProject(project: SshProject) {
  const connections = connectionSnapshot();
  const previous = snapshot();
  write(previous.some(p => p.id === project.id) ? previous.map(p => p.id === project.id ? project : p) : [...previous, project], connections.some(c => c.host === project.host) ? connections : [...connections, { host: project.host, name: project.host, enabled: true, color: randomColor() }]);
}
export function removeSshProject(id: string) {
  write(snapshot().filter(p => p.id !== id), connectionSnapshot());
}
function requireEnabled(host: string) {
  if (connectionSnapshot().some(c => c.host === host && !c.enabled)) throw new Error("This SSH connection is disabled. Enable it in Settings → Connections.");
}
async function browserSsh<T>(action: string, request: unknown = {}): Promise<T> {
  const response = await fetch(`/__burette/ssh/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Burette-SSH": "1" }, body: JSON.stringify(request),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Start the local preview server with BURETTE_DEV_SSH=1 to browse SSH projects.");
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "SSH request failed");
  return value as T;
}
export function sshHosts() {
  return isTauriRuntime() ? invoke<{ alias: string }[]>("ssh_hosts") : browserSsh<{ alias: string }[]>("hosts");
}
export async function sshList(host: string, root: string, path = ".", chemical = false) {
  requireEnabled(host);
  try {
    const value = await (isTauriRuntime() ? invoke<SshDirectory>("ssh_list", { request: { host, root, path, chemical } }) : browserSsh<SshDirectory>("list", { host, root, path, chemical }));
    recordSshStatus(host, true);
    return value;
  } catch (error) { recordSshStatus(host, false); throw error; }
}
export async function sshPreview(project: SshProject, path: string) {
  requireEnabled(project.host);
  if (!isTauriRuntime()) return browserSsh<string>("preview", { host: project.host, root: project.root, path });
  return invoke<string>("ssh_preview", { request: { host: project.host, root: project.root, path } });
}

export async function sshDeleteFolder(project: SshProject, path: string) {
  requireEnabled(project.host);
  const request = { host: project.host, root: project.root, path };
  return isTauriRuntime()
    ? invoke<{ deleted: string }>("ssh_delete_folder", { request })
    : browserSsh<{ deleted: string }>("delete-folder", request);
}
