import type { BuildInfo, ShellActions } from "../types";
import { ShortcutTooltip } from "../shortcut-tooltip";

function buildLabel(info: BuildInfo) {
  if (info.isBrowserDev) return `Browser dev · v${info.version}`;
  if (info.isDevBuild) return `Dev ${info.flavor ?? "local"} · v${info.version}`;
  return `Release · v${info.version}`;
}

function buildDetail(info: BuildInfo) {
  return (info.limitations.length > 0 ? info.limitations : info.notes).join(" · ");
}

export function WelcomeScreen({ actions, buildInfo }: { actions: ShellActions; buildInfo: BuildInfo }) {
  return (
    <div className="new-tab-page">
      <div className="new-tab-copy">
        <div className="new-tab-eyebrow-row">
          <p className="new-tab-eyebrow">Burrete Desktop</p>
          {buildInfo.isDevBuild ? (
            <span className="new-tab-build-badge" title={`${buildInfo.identifier}\n${buildDetail(buildInfo)}`}>
              {buildLabel(buildInfo)}
            </span>
          ) : null}
        </div>
        <h1>Open a molecular structure</h1>
        <p className="new-tab-description">
          Use the shell to inspect files quickly, switch renderers when needed, and return to recent structures without leaving the workspace.
        </p>
        {buildInfo.isDevBuild ? (
          <p className="new-tab-build-detail">{buildDetail(buildInfo)}</p>
        ) : null}
      </div>
      <div className="new-tab-actions">
        <button type="button" className="welcome-primary" onClick={() => void actions.chooseFiles()}>
          Open Structure <kbd>⌘O</kbd>
          <ShortcutTooltip label="Open Structure" shortcut="⌘O" />
        </button>
        <button type="button" onClick={actions.openCommandPalette}>
          Command Palette <kbd>⌘P</kbd> <kbd>/</kbd>
          <ShortcutTooltip label="Command Palette" shortcut="⌘P /" />
        </button>
        <button type="button" onClick={actions.openSettings}>
          Settings <kbd>⌘,</kbd>
          <ShortcutTooltip label="Settings" shortcut="⌘," />
        </button>
      </div>
    </div>
  );
}
