import { useState } from "react";
import { TextDocumentInfoPanel } from "@/components/text-document-info-panel";
import { Button } from "@/components/ui/button";
import type { TextFileDocument } from "@/types";

const report: TextFileDocument = { id: "report", title: "Binding-affinity-report.md", path: "/examples/Binding-affinity-report.md", extension: "md", language: "Markdown", byteCount: 2048, content: "# Report", truncated: false };
export function TextDocumentInfoExample() {
  const [partial, setPartial] = useState(false);
  const [result, setResult] = useState("");
  return <section className="w-full max-w-[340px] shrink-0" aria-label="File information example">
    <Button variant="secondary" className="mb-3" onClick={() => setPartial(value => !value)}>{partial ? "Full preview" : "Partial preview"}</Button>
    <div className="bg-(--color-surface)"><TextDocumentInfoPanel document={{ ...report, truncated: partial }} actions={{
      showTextFileMetadata: () => setResult("Metadata selected"), revealPath: () => setResult("File selected"), copyPath: () => setResult("Path copied"),
    }} /></div>
    {result ? <output>{result}</output> : null}
  </section>;
}
