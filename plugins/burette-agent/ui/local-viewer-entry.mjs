import { connectViewer } from './mcp-viewer-entry.mjs';
import { startLocalViewer } from './local-viewer.mjs';
import { startNativeWorkspace } from './native-workspace.mjs';
import { workspaceLoadingStyle, workspaceLoadingMarkup } from './native-workspace-loading.mjs';

await connectViewer('burette-viewer', async (app, result) => {
  if (result.structuredContent?.workspace !== true) {
    await startLocalViewer(app, result);
    return;
  }
  // A cached open_viewer binding may still target local-viewer.html. The
  // session, not that stale URI, owns the requested full-workspace behavior.
  // Drop the compact payload before loading any workspace assets or engines.
  document.getElementById('burette-compact-style')?.remove();
  const status = document.getElementById('status');
  status.innerHTML = workspaceLoadingMarkup;
  const root = document.createElement('div');
  root.id = 'root';
  document.body.replaceChildren(status, root);
  delete document.body.dataset.displayMode;
  const style = document.createElement('style');
  style.textContent = workspaceLoadingStyle;
  document.head.appendChild(style);
  await startNativeWorkspace(app, result);
});
