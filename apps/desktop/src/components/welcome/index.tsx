import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { isHostedMcpWidget } from "@/lib/hosted-mcp-widget";
import type { ShellActions } from "../types";

function HostedStructurePending() {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Empty className="new-tab-page border-0 gap-5" role="status" aria-live="polite">
      <EmptyHeader className="new-tab-copy">
        <EmptyTitle className="text-xl font-normal">
          {timedOut ? "Structure has not loaded" : "Loading molecular structure…"}
        </EmptyTitle>
        <EmptyDescription>
          {timedOut
            ? "The viewer has not received or opened the structure. Scene actions are not confirmed. Try reopening this result."
            : "Waiting for the structure from this tool result. Scene actions are not confirmed yet."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function WelcomeScreen({ actions }: { actions: ShellActions }) {
  if (isHostedMcpWidget()) return <HostedStructurePending />;
  return (
    <Empty className="new-tab-page border-0 gap-5">
      <EmptyHeader className="new-tab-copy">
        <EmptyTitle className="text-xl font-normal">Open a structure</EmptyTitle>
        <EmptyDescription>Drop a file here or open one</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="new-tab-actions flex-row justify-center gap-3">
        <Button
          type="button"
          data-analytics-control="open_structure"
          onClick={() => void actions.chooseFiles()}
        >
          Open file
        </Button>
        <Kbd>⌘O</Kbd>
      </EmptyContent>
    </Empty>
  );
}
import { useEffect, useState } from "react";
