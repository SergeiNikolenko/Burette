// The desktop platform the webview runs on. macOS hosts the WKWebView shell
// (vibrancy, traffic lights, AppKit menus, Quick Look, Metal); Linux hosts
// WebKitGTK and Windows hosts WebView2, both in an opaque, natively decorated
// window with the menu bar inside it.
export type DesktopPlatform = "macos" | "linux" | "windows" | "other";

export function desktopPlatform(): DesktopPlatform {
  // Without a navigator (non-DOM tests) the macOS shell is the default.
  if (typeof navigator === "undefined") return "macos";
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  if (/Mac|iPhone|iPad|iPod/u.test(platform) || /Mac OS X/u.test(userAgent)) return "macos";
  if (/Android/u.test(userAgent)) return "other";
  if (/^Win/u.test(platform) || /Windows/u.test(userAgent)) return "windows";
  if (/Linux/u.test(platform) || /Linux/u.test(userAgent)) return "linux";
  return "other";
}

export function isMacPlatform() {
  return desktopPlatform() === "macos";
}

/** Status-text name of the native compute backend; Metal exists only on macOS. */
export function nativeComputeLabel(macLabel = "Metal") {
  return isMacPlatform() ? macLabel : "native compute";
}

/** The file manager as an "Open in" destination. */
export function fileManagerName() {
  const platform = desktopPlatform();
  return platform === "macos" ? "Finder" : platform === "windows" ? "File Explorer" : "Files";
}

/** The file manager inside a sentence; Linux file managers have no fixed name. */
export function fileManagerReference() {
  const platform = desktopPlatform();
  return platform === "macos" ? "Finder" : platform === "windows" ? "File Explorer" : "the file manager";
}

/** "Reveal in Finder" on macOS, "Show in File Explorer" on Windows. */
export function revealInFileManagerLabel(macLabel = "Reveal in Finder") {
  const platform = desktopPlatform();
  return platform === "macos" ? macLabel : platform === "windows" ? "Show in File Explorer" : "Show in File Manager";
}

/** Where deleted files go: the Recycle Bin on Windows, the Trash elsewhere. */
export function trashName() {
  return desktopPlatform() === "windows" ? "Recycle Bin" : "Trash";
}

/** Sentence-case file menu command; the Recycle Bin keeps its proper-noun capitals. */
export function moveToTrashMenuLabel() {
  return desktopPlatform() === "windows" ? "Move to Recycle Bin" : "Move to trash";
}

/** Where saved API keys and passwords live, inside a sentence. */
export function credentialStoreName() {
  const platform = desktopPlatform();
  return platform === "macos" ? "your login keychain" : platform === "windows" ? "Windows Credential Manager" : "the system keyring";
}

/** Key-cap name of the meta key (KeyboardEvent.metaKey). */
export function metaKeyName() {
  const platform = desktopPlatform();
  return platform === "macos" ? "Cmd" : platform === "windows" ? "Win" : "Super";
}
