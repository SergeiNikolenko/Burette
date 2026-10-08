import { useEffect, useState } from "react";
import { Button, ButtonStyleContext } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Folder } from "@/components/ui/app-icons";
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
    <Empty className="new-tab-page border-0">
      <EmptyContent className="new-tab-actions">
        <ButtonStyleContext.Provider value="app">
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            aria-label="Open file"
            aria-keyshortcuts="Meta+O"
            data-analytics-control="open_structure"
            onClick={() => void actions.chooseFiles()}
          >
            <Folder className="size-4" aria-hidden />
            Open file
            <Kbd className="ml-2 bg-transparent text-(--color-text-tertiary)" aria-hidden>⌘O</Kbd>
          </Button>
        </ButtonStyleContext.Provider>
      </EmptyContent>
    </Empty>
  );
}
