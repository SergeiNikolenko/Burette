import { useState } from "react";
import { PerformReactionDialog } from "@/components/perform-reaction-dialog";
import { Button } from "@/components/ui/button";

const request = { documentId: "reaction-example", documentTitle: "Series" };
export function ReactionExample() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("");
  return <section aria-label="Reaction example">
    <Button variant="secondary" onClick={() => setOpen(true)}>Perform reaction</Button>
    {result && <output className="ml-3 text-sm">{result}</output>}
    <PerformReactionDialog request={open ? request : null} onDismiss={() => setOpen(false)}
      onRun={(_id, label, _smarts, coReactants) => setResult(`${label}: ${coReactants.join(", ")}`)} />
  </section>;
}
