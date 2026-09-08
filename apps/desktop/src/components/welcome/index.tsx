import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import type { ShellActions } from "../types";

export function WelcomeScreen({ actions }: { actions: ShellActions }) {
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
