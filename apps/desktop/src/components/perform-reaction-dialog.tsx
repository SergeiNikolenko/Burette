import { Input } from "./ui/input";
import { useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

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
  const problemId = useId();
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
    if (smarts.split(">").length !== 3) return { field: "reaction", message: "A reaction reads reactants>agents>products." };
    if (reactantCount > 1 && parsedCoReactants.length !== reactantCount - 1) {
      return { field: "coReactants", message: `This reaction takes ${reactantCount} reactants, so it needs ${reactantCount - 1} co-reactant${reactantCount === 2 ? "" : "s"} beside each row's structure.` };
    }
    return null;
  }, [parsedCoReactants.length, reactantCount, smarts]);
  const ready = Boolean(request) && label.trim().length > 0 && smarts.trim().length > 0 && !problem;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="default" className="overscroll-contain">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !ready) return;
          onRun(request.documentId, label.trim(), smarts.trim(), parsedCoReactants);
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Perform reaction</DialogTitle>
            <DialogDescription className="sr-only">Add reaction products to {request?.documentTitle}.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-xs">
            <span>New column name</span>
            <Input variant="field" name="label" autoComplete="off"
              type="text"
              value={label}
              maxLength={80}
              placeholder="Product"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs">
            <span>Reaction SMARTS</span>
            <Textarea name="reaction" autoComplete="off" className="max-h-48 resize-y font-mono"
              aria-invalid={problem?.field === "reaction"} aria-describedby={problem?.field === "reaction" ? problemId : undefined}
              value={smarts}
              rows={3}
              spellCheck={false}
              placeholder="[C:1](=[O:2])[OH].[N:3]>>[C:1](=[O:2])[N:3]"
              onChange={(event) => setSmarts(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs">
            <span>Co-reactants</span>
            <Input variant="field" name="coReactants" autoComplete="off"
              aria-invalid={problem?.field === "coReactants"} aria-describedby={problem?.field === "coReactants" ? problemId : undefined}
              type="text"
              value={coReactants}
              spellCheck={false}
              placeholder="NCC"
              onChange={(event) => setCoReactants(event.target.value)}
            />
          </label>
          {problem && <p id={problemId} className="break-words text-sm text-(--color-text-danger)" role="alert">{problem.message}</p>}
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs">Reactions</legend>
            <div className="flex flex-wrap gap-1">
              {REACTION_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="secondary" size="xs"
                  onClick={() => {
                    setSmarts(preset.smarts);
                    setCoReactants(preset.coReactants);
                    setLabel(preset.label);
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-(--color-text-secondary)">
            Each row's structure is the first reactant; the co-reactants supply the rest.
            A row the reaction does not fit keeps the reason in its cell.
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!ready}>Add column</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
