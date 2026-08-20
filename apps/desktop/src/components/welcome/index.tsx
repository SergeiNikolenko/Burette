import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { BuildInfo, ShellActions } from "../types";
import { ShortcutTooltip } from "../shortcut-tooltip";

function buildLabel(info: BuildInfo) {
  if (info.isAgentShell) return `Agent shell · v${info.version}`;
  if (info.isBrowserDev) return `Browser dev · v${info.version}`;
  if (info.isDevBuild) return `Dev ${info.flavor ?? "local"} · v${info.version}`;
  return `Release · v${info.version}`;
}

function buildDetail(info: BuildInfo) {
  return (info.limitations.length > 0 ? info.limitations : info.notes).join(" · ");
}

export function WelcomeScreen({ actions, buildInfo }: { actions: ShellActions; buildInfo: BuildInfo }) {
  return (
    <Empty className="new-tab-page border-0">
      <EmptyHeader className="new-tab-copy max-w-2xl">
        <div className="flex min-w-0 items-center gap-2.5">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Burette Desktop</p>
          {buildInfo.isDevBuild ? (
            <Badge
              variant="secondary"
              className="max-w-65 truncate uppercase"
              title={`${buildInfo.identifier}\n${buildDetail(buildInfo)}`}
            >
              {buildLabel(buildInfo)}
            </Badge>
          ) : null}
        </div>
        <EmptyTitle className="text-2xl font-normal">Open a molecular structure</EmptyTitle>
        {buildInfo.isDevBuild ? (
          <EmptyDescription>{buildDetail(buildInfo)}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      <EmptyContent className="new-tab-actions">
        <WelcomeAction
          label="Open Structure"
          shortcut="⌘O"
          keys={["⌘O"]}
          analytics="open_structure"
          onClick={() => void actions.chooseFiles()}
        />
        <WelcomeAction
          label="Command Palette"
          shortcut="⌘P /"
          keys={["⌘P", "/"]}
          analytics="open_command_palette"
          onClick={actions.openCommandPalette}
        />
        <WelcomeAction
          label="Settings"
          shortcut="⌘,"
          keys={["⌘,"]}
          analytics="open_settings"
          onClick={actions.openSettings}
        />
      </EmptyContent>
    </Empty>
  );
}

function WelcomeAction({
  label,
  shortcut,
  keys,
  analytics,
  onClick,
}: {
  label: string;
  shortcut: string;
  keys: string[];
  analytics: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="relative text-muted-foreground hover:text-foreground"
      data-analytics-control={analytics}
      onClick={onClick}
    >
      {label}
      <KbdGroup>
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
      <ShortcutTooltip label={label} shortcut={shortcut} />
    </Button>
  );
}
