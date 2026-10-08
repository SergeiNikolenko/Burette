import { useState, type ComponentProps } from "react";
import { JobsPanel } from "@/components/jobs-panel";
import { Button } from "@/components/ui/button";

type JobsState = ComponentProps<typeof JobsPanel>["state"];
const initial: JobsState = {
  conformerJobs: [
    { id: "align", title: "Align structures", operation: "alignment", inputTitle: "Kinase series", status: "running", startedAt: 5, progress: "12 of 20 structures", cancelable: true },
    { id: "minimize", title: "Minimize energy", operation: "semiempirical", inputTitle: "Ligand 4", status: "success", startedAt: 3, primaryOpenPath: "/result.sdf", reportPath: "/report.md", logPath: "/calculation.log" },
    { id: "failed", title: "Generate conformers", operation: "grid-generate", inputTitle: "Ligand 7", status: "failed", startedAt: 1, error: "The structure contains an unsupported atom.", reportPath: "/failure.md" },
  ],
  xtbJobs: [{ id: "waiting", title: "Optimize geometry", operation: "optimize", inputLabel: "Ligand 8", status: "queued", startedAt: 4 }],
  derivedColumnJobs: [{ id: "columns", columnLabel: "Molecular properties", documentTitle: "Library", status: "success", startedAt: 2, processedRows: 20, failedRows: 1, totalRows: 20 }],
  databaseJobs: [{ id: "search", title: "Structure search", provider: "pubchem", query: "aspirin", status: "success", startedAt: 0, recordCount: 3, documentId: "search-result" }],
};

// Production UI with local state only: never submit a calculation or touch files.
export function JobExamples() {
  const [state, setState] = useState(initial);
  const [selection, setSelection] = useState("");
  return <section className="w-full max-w-[600px] shrink-0" aria-label="Calculation examples">
    <div className="mb-4 flex items-center justify-between"><h2 className="text-[24px] leading-8">Calculations</h2>
      <Button variant="ghost" size="xs" onClick={() => { setState(initial); setSelection(""); }}>Reset calculations</Button></div>
    <div className="dock-content bg-(--color-surface)"><JobsPanel state={state} actions={{
      openPaths: async () => setSelection("Result selected"), openTextPaths: async () => setSelection("Report selected"), selectDocument: () => setSelection("Search result selected"),
      cancelConformerJob: async id => setState(s => ({ ...s, conformerJobs: s.conformerJobs.map(job => job.id === id ? { ...job, status: "cancelled", progress: null } : job) })),
      cancelXtbJob: async id => setState(s => ({ ...s, xtbJobs: s.xtbJobs.map(job => job.id === id ? { ...job, status: "cancelled" } : job) })),
      clearConformerJobs: () => setState(s => ({ ...s, conformerJobs: s.conformerJobs.filter(job => job.status === "running") })),
      clearXtbJobs: () => setState(s => ({ ...s, xtbJobs: s.xtbJobs.filter(job => job.status === "running" || job.status === "queued") })),
      clearDerivedColumnJobs: () => setState(s => ({ ...s, derivedColumnJobs: s.derivedColumnJobs.filter(job => job.status === "running") })),
      clearDatabaseJobs: () => setState(s => ({ ...s, databaseJobs: s.databaseJobs.filter(job => job.status === "running") })),
    }} /></div>
    {selection && <output>{selection}</output>}
  </section>;
}
