import { Input } from "./ui/input";
import { useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";


export type SubstructureCountRequest = {
  documentId: string;
  documentTitle: string;
};

// Queries a medicinal chemist reaches for first, so the common cases are one
// click rather than a SMARTS lookup.
const PRESETS: Array<{ label: string; smarts: string }> = [
  { label: "Benzene ring", smarts: "c1ccccc1" },
  { label: "Pyridine", smarts: "c1ccncc1" },
  { label: "Carboxylic acid", smarts: "[CX3](=O)[OX2H1]" },
  { label: "Ester", smarts: "[CX3](=O)[OX2][#6]" },
  { label: "Amide", smarts: "[CX3](=O)[NX3]" },
  { label: "Primary amine", smarts: "[NX3;H2][#6]" },
  { label: "Hydroxyl", smarts: "[OX2H]" },
  { label: "Nitro", smarts: "[N+](=O)[O-]" },
  { label: "Halogen", smarts: "[F,Cl,Br,I]" },
  { label: "Sulfonamide", smarts: "[SX4](=O)(=O)[NX3]" },
];

export function SubstructureCountDialog({
  request,
  validateQuery,
  onDismiss,
  onRun,
}: {
  request: SubstructureCountRequest | null;
  // Compiling the query is the engines' job; the dialog only reports what they
  // say, so a query that will not run never starts a job.
  validateQuery: (smarts: string) => Promise<string | null>;
  onDismiss: () => void;
  onRun: (documentId: string, label: string, smarts: string) => void;
}) {
  const problemId = useId();
  const [label, setLabel] = useState("");
  const [smarts, setSmarts] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [validatedQuery, setValidatedQuery] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setLabel("");
    setSmarts("");
    setProblem(null);
    setValidatedQuery(null);
  }, [request?.documentId]);

  useEffect(() => {
    const query = smarts.trim();
    setValidatedQuery(null);
    setProblem(null);
    if (!request || !query) {
      setProblem(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      void validateQuery(query)
        .then((message) => {
          if (cancelled) return;
          setProblem(message?.replace(/^SmilesParser:\s*/u, "") ?? null);
          if (!message) setValidatedQuery(query);
        })
        .catch((error) => { if (!cancelled) { console.error("[Substructure query]", error); setProblem("Could not check this query. Edit it to try again."); } })
        .finally(() => { if (!cancelled) setChecking(false); });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [smarts, validateQuery, request?.documentId]);

  const columnName = useMemo(() => label.trim() || (smarts.trim() ? `Count of ${smarts.trim()}` : ""), [label, smarts]);
  const ready = Boolean(request) && smarts.trim().length > 0 && validatedQuery === smarts.trim() && !problem && !checking;

  return (
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact" className="overscroll-contain">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !ready) return;
          onRun(request.documentId, columnName, smarts.trim());
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Substructure count</DialogTitle>
            <DialogDescription className="sr-only">Count matches for a query in each molecule.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-xs"><span>Query (SMARTS or SMILES)</span>
            <Input variant="field" name="query" autoComplete="off" value={smarts} maxLength={400} spellCheck={false}
              placeholder="[CX3](=O)[OX2H1]" aria-invalid={Boolean(problem)} aria-describedby={problem ? problemId : undefined}
              onChange={event => setSmarts(event.target.value)} />
          </label>
          {problem && <p id={problemId} className="break-words text-sm text-(--color-text-danger)" role="alert">{problem}</p>}
          <label className="flex flex-col gap-2 text-xs"><span>New column name</span>
            <Input variant="field" name="label" autoComplete="off" value={label} maxLength={80}
              placeholder={smarts.trim() ? `Count of ${smarts.trim()}` : "Carboxylic acids"}
              onChange={event => setLabel(event.target.value)} />
          </label>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs">Common queries</legend>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(preset => <Button key={preset.label} type="button" variant="secondary" size="xs" onClick={() => {
                setSmarts(preset.smarts);
                if (!label.trim()) setLabel(preset.label);
              }}>{preset.label}</Button>)}
            </div>
          </fieldset>
          <DialogFooter className="gap-2">
            {checking && <span className="mr-auto flex items-center gap-2 text-xs text-(--color-text-secondary)" role="status"><Spinner className="size-3" aria-hidden />Checking…</span>}
            <Button type="button" variant="secondary" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!ready}>Add column</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
