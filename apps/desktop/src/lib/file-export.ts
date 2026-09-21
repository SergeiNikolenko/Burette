export function downloadTextFile(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBase64File(fileName: string, base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeExportFileName(name: string) {
  return (name || "export.txt")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/^\.+/g, "")
    .trim()
    .slice(0, 120) || "export.txt";
}

export function stableTextDocumentId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `text-${(hash >>> 0).toString(36)}`;
}

export function exportDialogFilters(fileName: string, mimeType: string) {
  const extension = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return undefined;
  const name = mimeType.includes("csv")
    ? "CSV"
    : (mimeType.includes("smiles") || extension === "smi" || extension === "smiles" ? "SMILES" : "Text");
  return [{ name, extensions: [extension] }];
}
