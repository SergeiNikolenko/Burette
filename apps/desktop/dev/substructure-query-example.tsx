import { useState } from "react";
import { SubstructureCountDialog } from "@/components/substructure-count-dialog";
import { compileSubstructureQuery } from "@/lib/derived-column-compute.mjs";
import { Button } from "@/components/ui/button";

// The production parser validates locally; the submit callback does not start a job.
async function validateQuery(query: string) {
  const ocl = await import("openchemlib");
  try { compileSubstructureQuery(ocl, query); return null; }
  catch (error) { return (error instanceof Error ? error.message : String(error)).replace(/^Class\$\w+:\s*/u, ""); }
}

export function SubstructureQueryExample() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("");
  return <section aria-label="Substructure query" className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" onClick={() => setOpen(true)}>Substructure count</Button>
    {result && <output className="text-sm">{result}</output>}
    <SubstructureCountDialog request={open ? { documentId: "series", documentTitle: "Series" } : null}
      validateQuery={validateQuery} onDismiss={() => setOpen(false)} onRun={(_id, label, query) => setResult(`${label}: ${query}`)} />
  </section>;
}
