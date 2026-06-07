import { appInstanceLabel } from "../../lib/instance";
import { RadixDropdownMenu } from "../radix-menu";
import type { BuildInfo, ShellActions, ShellViewState } from "../types";

function buildLabel(info: BuildInfo) {
  if (info.isBrowserDev) return `BROWSER DEV · v${info.version}`;
  if (info.isDevBuild) return `DEV ${info.flavor ?? "local"} · v${info.version}`;
  return `v${info.version}`;
}

function buildDetail(info: BuildInfo) {
  const details = info.limitations.length > 0 ? info.limitations : info.notes;
  return details.join(" · ");
}

export function WorkspaceSwitcher({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const buildInfo = state.buildInfo;
  const buildTitle = [
    `${buildInfo.name} ${buildLabel(buildInfo)}`,
    buildInfo.identifier,
    ...buildInfo.notes,
    ...buildInfo.limitations,
  ].filter(Boolean).join("\n");

  return (
    <div className="sidebar-footer">
      <RadixDropdownMenu
        side="top"
        align="start"
        items={[
        {
          kind: "item",
          id: "add-project-folder",
          text: "Add Project Folder...",
          action: () => {
            void actions.chooseWorkspace();
          },
        },
        {
          kind: "item",
          id: "open-active-project-folder",
          text: "Open Active Project Folder",
          action: () => {
            void actions.openWorkspaceFolder();
          },
        },
        ]}
        trigger={(
          <button
            type="button"
            className="sidebar-product"
            aria-label={"Open workspace menu for " + appInstanceLabel}
            title={appInstanceLabel}
          >
            <span className="sidebar-product-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinejoin="round">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M8.7071 2.39644C8.31658 2.00592 7.68341 2.00592 7.29289 2.39644L4.46966 5.21966L3.93933 5.74999L4.99999 6.81065L5.53032 6.28032L7.99999 3.81065L10.4697 6.28032L11 6.81065L12.0607 5.74999L11.5303 5.21966L8.7071 2.39644ZM5.53032 9.71966L4.99999 9.18933L3.93933 10.25L4.46966 10.7803L7.29289 13.6035C7.68341 13.9941 8.31658 13.9941 8.7071 13.6035L11.5303 10.7803L12.0607 10.25L11 9.18933L10.4697 9.71966L7.99999 12.1893L5.53032 9.71966Z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span className="sidebar-product-label">{appInstanceLabel}</span>
          </button>
        )}
      />
      <div
        className="sidebar-build-badge"
        title={buildTitle}
        aria-label={buildTitle}
      >
        <span className="sidebar-build-label">{buildLabel(buildInfo)}</span>
        <span className="sidebar-build-detail">{buildDetail(buildInfo)}</span>
      </div>
      <button
        type="button"
        className="sidebar-settings-button"
        onClick={actions.openSettings}
        aria-label="Open settings"
      >
        <span className="sidebar-settings-icon" aria-hidden="true">
          <GearIcon />
        </span>
        <span className="sidebar-settings-label">Settings</span>
      </button>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M7.6 2.25H10.4L10.82 4.06C11.15 4.18 11.47 4.32 11.77 4.5L13.36 3.52L15.34 5.5L14.36 7.09C14.54 7.39 14.68 7.71 14.8 8.04L16.61 8.46V11.26L14.8 11.68C14.68 12.01 14.54 12.33 14.36 12.63L15.34 14.22L13.36 16.2L11.77 15.22C11.47 15.4 11.15 15.54 10.82 15.66L10.4 17.47H7.6L7.18 15.66C6.85 15.54 6.53 15.4 6.23 15.22L4.64 16.2L2.66 14.22L3.64 12.63C3.46 12.33 3.32 12.01 3.2 11.68L1.39 11.26V8.46L3.2 8.04C3.32 7.71 3.46 7.39 3.64 7.09L2.66 5.5L4.64 3.52L6.23 4.5C6.53 4.32 6.85 4.18 7.18 4.06L7.6 2.25Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <circle cx="9" cy="9.86" r="2.65" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}
