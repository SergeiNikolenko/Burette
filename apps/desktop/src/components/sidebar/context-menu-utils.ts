export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "linux";
  const userAgent = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/i.test(userAgent)) return "macos";
  if (/Win/i.test(userAgent)) return "windows";
  return "linux";
}

export function revealLabelForPlatform(platform: Platform): string {
  switch (platform) {
    case "macos":
      return "Reveal in Finder";
    case "windows":
      return "Reveal in Explorer";
    case "linux":
      return "Show in Folder";
  }
}
