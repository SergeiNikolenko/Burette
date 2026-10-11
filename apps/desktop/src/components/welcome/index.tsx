import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Atom } from "@/components/ui/app-icons";
import { Kbd } from "@/components/ui/kbd";
import { isHostedMcpWidget } from "@/lib/hosted-mcp-widget";
import type { ShellActions } from "../types";
import { NativeWorkspaceHome } from "./native-workspace-home";

function HostedStructurePending() {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Empty className="new-tab-page border-0 gap-3" role="status" aria-live="polite">
      {!timedOut && <Spinner aria-hidden className="size-8 text-(--color-text-secondary)" />}
      <EmptyHeader className="new-tab-copy">
        <EmptyTitle className="text-lg leading-6 font-medium tracking-normal text-(--color-text)">
          {timedOut ? "Structure has not loaded" : "Loading molecular structure…"}
        </EmptyTitle>
        {timedOut && <EmptyDescription className="text-sm text-(--color-text-secondary)">
          Reopen this result to try again.
        </EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

export function WelcomeScreen({ actions }: { actions: ShellActions }) {
  if (isHostedMcpWidget()) return <HostedStructurePending />;
  const home = window.BuretteMcpWorkspace?.home;
  if (home) return <NativeWorkspaceHome actions={actions} home={home} />;
  // Codex new-chat hero: a 56px mark at 30% opacity, 24px above a 28px title,
  // with a single soft action in place of the composer.
  return (
    <Empty className="new-tab-page border-0 gap-6">
      <EmptyMedia className="mb-0 size-14 text-(--color-text) opacity-30 [&_svg]:size-14" aria-hidden>
        <Atom />
      </EmptyMedia>
      <EmptyHeader className="new-tab-copy">
        <EmptyTitle className="text-[28px] leading-[1.2] font-normal tracking-normal text-(--color-text)">Drop a structure here</EmptyTitle>
      </EmptyHeader>
      <EmptyContent className="new-tab-actions flex-row justify-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          aria-keyshortcuts="Meta+O"
          data-analytics-control="open_structure"
          onClick={() => void actions.chooseFiles()}
        >
          Open file
        </Button>
        <Kbd className="bg-transparent text-(--color-text-tertiary)" aria-hidden>⌘O</Kbd>
      </EmptyContent>
    </Empty>
  );
}
