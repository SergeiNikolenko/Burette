import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
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
  return (
    <Empty className="new-tab-page border-0 gap-6">
      <EmptyHeader className="new-tab-copy w-full max-w-[330px]">
        <EmptyTitle role="heading" aria-level={1} className="text-(length:--text-heading-lg) leading-9 font-semibold tracking-normal text-(--color-text)">
          Open a structure
        </EmptyTitle>
      </EmptyHeader>
      <EmptyContent className="new-tab-actions max-w-[330px] gap-4">
        <Button
          type="button"
          size="lg"
          className="w-[157px] max-w-full rounded-full"
          aria-keyshortcuts="Meta+O"
          data-analytics-control="open_structure"
          onClick={() => void actions.chooseFiles()}
        >
          Open file
        </Button>
        <Kbd className="bg-transparent text-sm text-(--color-text-tertiary)" aria-label="Command O">⌘O</Kbd>
      </EmptyContent>
    </Empty>
  );
}
