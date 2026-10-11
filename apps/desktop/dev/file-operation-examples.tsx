import { useState } from "react";
import { FileOperationDialog, TrashFilesDialog, type FileOperationRequest } from "@/components/file-operation-dialogs";
import { Button } from "@/components/ui/button";

export function FileOperationExamples() {
  const [request, setRequest] = useState<FileOperationRequest | null>(null);
  const [name, setName] = useState("Series.sdf");
  const [trash, setTrash] = useState(false);
  const [result, setResult] = useState("");
  const choose = (operation: "rename" | "createFolder") => {
    const name = operation === "rename" ? "Series.sdf" : "Untitled Folder";
    setName(name); setRequest({ operation, path: "/examples/Series.sdf", name });
  };
  return <section className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" onClick={() => choose("rename")}>Rename file</Button>
    <Button variant="secondary" onClick={() => choose("createFolder")}>New folder</Button>
    <Button variant="secondary" onClick={() => setTrash(true)}>Retry moving files</Button>
    {result ? <output>{result}</output> : null}
    <FileOperationDialog request={request} name={name} onNameChange={setName} error="" busy={false}
      onDismiss={() => setRequest(null)} onRun={next => { setResult("name" in next ? next.name : next.operation); setRequest(null); }} />
    <TrashFilesDialog paths={trash ? ["/examples/Series B.sdf", "/examples/Series C.sdf"] : []} completed={1}
      error="Could not move these files to Trash. Try again." busy={false} onDismiss={() => setTrash(false)}
      onRetry={() => { setResult("2 files selected"); setTrash(false); }} />
  </section>;
}
