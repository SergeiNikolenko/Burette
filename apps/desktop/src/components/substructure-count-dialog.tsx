import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";

import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

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
  const portalContainer = useAppShellPortalContainer();
  const [label, setLabel] = useState("");
  const [smarts, setSmarts] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!request) return;
    setLabel("");
    setSmarts("");
    setProblem(null);
  }, [request?.documentId]);

  useEffect(() => {
    const query = smarts.trim();
    if (!query) {
      setProblem(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      void validateQuery(query)
        .then((message) => { if (!cancelled) setProblem(message); })
        .catch((error) => { if (!cancelled) setProblem(error instanceof Error ? error.message : String(error)); })
        .finally(() => { if (!cancelled) setChecking(false); });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [smarts, validateQuery]);

  const columnName = useMemo(() => label.trim() || (smarts.trim() ? `Count of ${smarts.trim()}` : ""), [label, smarts]);
  const ready = Boolean(request) && smarts.trim().length > 0 && !problem && !checking;

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="substructure-count-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Substructure Count</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close substructure count">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="substructure-count-body" className="radix-dialog-body">
            <p className="calculate-properties-target">
              Counts how often the query occurs in each molecule of <strong>{request?.documentTitle}</strong>.
            </p>
            <label className="calculated-column-field">
              <span>Query (SMARTS or SMILES)</span>
              <input
                type="text"
                value={smarts}
                maxLength={400}
                spellCheck={false}
                placeholder="[CX3](=O)[OX2H1]"
                onChange={(event) => setSmarts(event.target.value)}
              />
            </label>
            {problem ? <div className="calculated-column-problem">{problem}</div> : null}
            <label className="calculated-column-field">
              <span>New column name</span>
              <input
                type="text"
                value={label}
                maxLength={80}
                placeholder={smarts.trim() ? `Count of ${smarts.trim()}` : "Carboxylic acids"}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <div className="calculated-column-help">
              <div className="calculated-column-help-title">Common queries</div>
              <div className="calculated-column-chips">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="calculated-column-chip"
                    onClick={() => {
                      setSmarts(preset.smarts);
                      if (!label.trim()) setLabel(preset.label);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="calculated-column-note">
                Each distinct set of matched atoms counts once: benzene occurs twice in naphthalene.
              </p>
            </div>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {checking ? "Checking the query…" : ready ? `Adds “${columnName}”` : "Enter a query"}
            </span>
            <div className="calculate-properties-actions">
              <Dialog.Close asChild>
                <button type="button" className="dock-action">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className="dock-action calculate-properties-run"
                disabled={!ready}
                onClick={() => {
                  if (!request || !ready) return;
                  onRun(request.documentId, columnName, smarts.trim());
                  onDismiss();
                }}
              >
                Add Column
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
