// The desktop platform the webview runs on. macOS hosts the WKWebView shell
// (vibrancy, traffic lights, AppKit menus, Quick Look, Metal); Linux hosts
// WebKitGTK in an opaque, natively decorated GTK window.
export type DesktopPlatform = "macos" | "linux" | "other";

export function desktopPlatform(): DesktopPlatform {
  // Without a navigator (non-DOM tests) the macOS shell is the default.
  if (typeof navigator === "undefined") return "macos";
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  if (/Mac|iPhone|iPad|iPod/u.test(platform) || /Mac OS X/u.test(userAgent)) return "macos";
  if (/Android/u.test(userAgent)) return "other";
  if (/Linux/u.test(platform) || /Linux/u.test(userAgent)) return "linux";
  return "other";
}

export function isMacPlatform() {
  return desktopPlatform() === "macos";
}

export function isLinuxPlatform() {
  return desktopPlatform() === "linux";
}

/** Status-text name of the native compute backend; Metal exists only on macOS. */
export function nativeComputeLabel(macLabel = "Metal") {
  return isMacPlatform() ? macLabel : "native compute";
}

/** The file manager as an "Open in" destination. */
export function fileManagerName() {
  return isMacPlatform() ? "Finder" : "Files";
}

/** "Reveal in Finder" on macOS; the file manager has no fixed name elsewhere. */
export function revealInFileManagerLabel(macLabel = "Reveal in Finder") {
  return isMacPlatform() ? macLabel : "Show in File Manager";
}
