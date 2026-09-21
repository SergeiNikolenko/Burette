import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";

import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

export type PerformReactionRequest = {
  documentId: string;
  documentTitle: string;
};

// The reactions DataWarrior ships as examples, written as the SMARTS RDKit's
// reaction runner reads. Each one takes the collection's structure as its first
// reactant, which is why the co-reactant field carries the rest.
const REACTION_PRESETS = [
  {
    id: "amidation",
    label: "Amidation",
    smarts: "[C:1](=[O:2])[OH].[N;!$(N=*);!$(N-[!#6;!#1]);!$(N-C=[O,N,S]):3]>>[C:1](=[O:2])[N:3]",
    coReactants: "NCC",
  },
  {
    id: "esterification",
    label: "Esterification",
    smarts: "[C:1](=[O:2])[OH].[O;H1;$(O[#6]):3]>>[C:1](=[O:2])[O:3]",
    coReactants: "CCO",
  },
  {
    id: "suzuki",
    label: "Suzuki coupling",
    smarts: "[c:1][Br,I,Cl].[c:2][B]([OH])[OH]>>[c:1][c:2]",
    coReactants: "OB(O)c1ccncc1",
  },
  {
    id: "reductive-amination",
    label: "Reductive amination",
    smarts: "[#6:1][CX3H1:2]=[OX1].[N;H2;!$(N-[!#6;!#1]):3]>>[#6:1][CH2:2][N:3]",
    coReactants: "NCC",
  },
];

function countReactants(smarts: string) {
  const reactants = smarts.split(">")[0] ?? "";
  if (!reactants.trim()) return 0;
  // Top-level '.' separates the reactants of a reaction SMARTS; the ones inside
  // brackets belong to recursive patterns and are not separators.
  let depth = 0;
  let count = 1;
  for (const character of reactants) {
    if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    else if (character === "." && depth === 0) count += 1;
  }
  return count;
}

export function PerformReactionDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: PerformReactionRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, label: string, smarts: string, coReactants: string[]) => void;
}) {
  const portalContainer = useAppShellPortalContainer();
  const [label, setLabel] = useState("Product");
  const [smarts, setSmarts] = useState("");
  const [coReactants, setCoReactants] = useState("");
  useEffect(() => {
    if (!request) return;
    setLabel("Product");
    setSmarts("");
    setCoReactants("");
  }, [request?.documentId]);

  const parsedCoReactants = useMemo(
    () => coReactants.split(/[\s,]+/u).map((value) => value.trim()).filter(Boolean),
    [coReactants],
  );
  const reactantCount = useMemo(() => countReactants(smarts), [smarts]);
  const problem = useMemo(() => {
    if (!smarts.trim()) return null;
    if (smarts.split(">").length !== 3) return "A reaction reads reactants>agents>products.";
    if (reactantCount > 1 && parsedCoReactants.length !== reactantCount - 1) {
      return `This reaction takes ${reactantCount} reactants, so it needs ${reactantCount - 1} co-reactant${reactantCount === 2 ? "" : "s"} beside each row's structure.`;
    }
    return null;
  }, [parsedCoReactants.length, reactantCount, smarts]);
  const ready = Boolean(request) && label.trim().length > 0 && smarts.trim().length > 0 && !problem;

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="perform-reaction-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Perform Reaction</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close perform reaction">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="perform-reaction-body" className="radix-dialog-body">
            <label className="calculated-column-field">
              <span>New column name</span>
              <input
                type="text"
                value={label}
                maxLength={80}
                placeholder="Product"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="calculated-column-field">
              <span>Reaction SMARTS</span>
              <textarea
                value={smarts}
                rows={3}
                spellCheck={false}
                placeholder="[C:1](=[O:2])[OH].[N:3]>>[C:1](=[O:2])[N:3]"
                onChange={(event) => setSmarts(event.target.value)}
              />
            </label>
            <label className="calculated-column-field">
              <span>Co-reactants</span>
              <input
                type="text"
                value={coReactants}
                spellCheck={false}
                placeholder="NCC"
                onChange={(event) => setCoReactants(event.target.value)}
              />
            </label>
            {problem ? <div className="calculated-column-problem">{problem}</div> : null}
            <div className="calculated-column-help">
              <div className="calculated-column-help-title">Reactions</div>
              <div className="calculated-column-chips">
                {REACTION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="calculated-column-chip"
                    onClick={() => {
                      setSmarts(preset.smarts);
                      setCoReactants(preset.coReactants);
                      setLabel(preset.label);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="calculated-column-note">
                Each row's structure is the first reactant; the co-reactants supply the rest.
                A row the reaction does not fit keeps the reason in its cell.
              </p>
            </div>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {ready ? "Ready" : "Name the column and enter a reaction"}
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
                  onRun(request.documentId, label.trim(), smarts.trim(), parsedCoReactants);
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
