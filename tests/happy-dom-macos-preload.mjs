// UI tests model the primary macOS shell on every host. happy-dom otherwise
// derives navigator.platform from process.platform ("X11; Darwin arm64" or
// "X11; Linux x64"), so platform-aware labels would depend on the test machine.
// Tests that cover Linux behavior mock lib/platform instead.
import DefaultBrowserSettings from 'happy-dom/lib/browser/DefaultBrowserSettings.js';

DefaultBrowserSettings.navigator.userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
