// Shared by the native resource and retained compact-resource bindings.
export const workspaceLoadingStyle = `
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}
body:has(#status:not([hidden]) :is(.workspace-loading,.workspace-failure)) #root{opacity:0;pointer-events:none}
body{background:#fff;color:#111}
html[data-theme="dark"] body{background:#000;color:#eee}
@media(prefers-color-scheme:dark){html:not([data-theme]) body{background:#000;color:#eee}}
#status{font:14px/1.5 system-ui;padding:12px;box-sizing:border-box}
#status[hidden]{display:none}
#status:not([hidden]):has(.workspace-loading,.workspace-failure){position:absolute;inset:0;z-index:100;display:grid;place-items:center;max-height:none;background:inherit}
.workspace-loading{max-width:100%;box-sizing:border-box}
.workspace-failure{text-align:center;max-width:36rem}
.workspace-failure button{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:4px 12px;cursor:pointer}
.workspace-loading-opening{display:flex;align-items:center;gap:12px}
.workspace-loading-spinner{width:16px;height:16px;flex:none;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:workspace-loading-spin .8s linear infinite}
@keyframes workspace-loading-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.workspace-loading-spinner{animation:none}}
body[data-closed]{height:48px}
`;

export const workspaceLoadingMarkup = '<div class="workspace-loading workspace-loading-opening" role="status"><span class="workspace-loading-spinner" aria-hidden="true"></span><span>Opening molecular structure...</span></div>';

export function showWorkspaceOpening(status) {
  if (status.querySelector('.workspace-loading-spinner')) return;
  const row = document.createElement('div');
  row.className = 'workspace-loading workspace-loading-opening';
  const spinner = document.createElement('span');
  spinner.className = 'workspace-loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  row.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = 'Opening molecular structure...';
  row.append(spinner, label);
  status.replaceChildren(row);
}

export function showWorkspaceFailure(status, message) {
  const row = document.createElement('div');
  row.className = 'workspace-failure';
  row.setAttribute('role', 'alert');
  const detail = document.createElement('p');
  detail.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.onclick = () => window.location.reload();
  row.append(detail, retry);
  status.replaceChildren(row);
  status.hidden = false;
}
