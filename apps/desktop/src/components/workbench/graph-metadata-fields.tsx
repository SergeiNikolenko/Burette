import { useState } from "react";
import type { GraphMetadataPatch } from "../../lib/workbench/graph-metadata";
import type { GraphSnapshot } from "../../lib/workbench/use-graph-draft";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** Mounted with a snapshot/selection key: unsaved fields never migrate to another atom. */
export function GraphMetadataFields({ snapshot, atomIndex, disabled, onApply }: {
  snapshot: GraphSnapshot; atomIndex: number | null; disabled: boolean;
  onApply: (patch: GraphMetadataPatch) => void;
}) {
  const metadata = snapshot.metadata!;
  const atom = atomIndex === null ? null : metadata.atoms[atomIndex];
  const residue = atom?.residue;
  const initial = { conformer: metadata.conformer.label ?? "", atomName: atom?.atomName ?? "",
    name: residue?.name ?? "", sequence: residue ? String(residue.sequence) : "", chain: residue?.chain ?? "", insertionCode: residue?.insertionCode ?? "" };
  const [fields, setFields] = useState(initial);
  const [clearResidue, setClearResidue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = (key: keyof typeof fields) => fields[key] !== initial[key];
  const residueChanged = ["name", "sequence", "chain", "insertionCode"].some(key => changed(key as keyof typeof fields));
  const dirty = changed("conformer") || Boolean(atom && (changed("atomName") || residueChanged || (clearResidue && residue)));
  const apply = () => {
    const patch: GraphMetadataPatch = {};
    if (Object.values(fields).some(value => /[\p{Cc}\p{Cf}]/u.test(value))) { setError("Remove control characters from the metadata fields."); return; }
    if (changed("conformer")) patch.conformerLabel = fields.conformer.trim() || null;
    if (atom) {
      const change: NonNullable<GraphMetadataPatch["atoms"]>[number] = { id: atom.id };
      if (changed("atomName")) change.atomName = fields.atomName.trim() || null;
      if (clearResidue) change.residue = null;
      else if (residueChanged) {
        if (!fields.name.trim() || !/^-?\d+$/u.test(fields.sequence) || Math.abs(Number(fields.sequence)) > 999999) {
          setError("Enter a residue name and an integer sequence from −999999 to 999999."); return;
        }
        change.residue = { name: fields.name.trim(), sequence: Number(fields.sequence), chain: fields.chain.trim(), insertionCode: fields.insertionCode.trim() };
      }
      if (Object.keys(change).length > 1) patch.atoms = [change];
    }
    setError(null);
    onApply(patch);
  };
  const field = (key: keyof typeof fields, label: string, maxLength: number) => <label className="workbench-field" key={key}>
    <span>{label}</span><Input variant="compact" aria-label={label} value={fields[key]} maxLength={maxLength} autoComplete="off" disabled={disabled}
      inputMode={key === "sequence" ? "numeric" : undefined}
      onChange={event => { setFields(previous => ({ ...previous, [key]: event.target.value })); if (!["conformer", "atomName"].includes(key)) setClearResidue(false); setError(null); }} />
  </label>;
  return <div className="workbench-selection-editor">
    {field("conformer", "Conformer label", 128)}
    {atom ? <>
      <div className="workbench-grid workbench-grid-3">{field("atomName", "Atom name", 32)}{field("name", "Residue name", 32)}{field("sequence", "Residue sequence", 7)}</div>
      <div className="workbench-grid workbench-grid-3">{field("chain", "Chain", 32)}{field("insertionCode", "Insertion code", 4)}
        <Button type="button" variant="ghost" size="xs" disabled={disabled || clearResidue || !(residue || fields.name || fields.sequence || fields.chain || fields.insertionCode)}
          onClick={() => { setFields(previous => ({ ...previous, name: "", sequence: "", chain: "", insertionCode: "" })); setClearResidue(true); setError(null); }}>Clear residue</Button>
      </div>
    </> : null}
    <div className="workbench-row"><Button type="button" variant="secondary" size="xs" disabled={disabled || !dirty} onClick={apply}>Apply metadata</Button></div>
    {error ? <p role="alert" className="workbench-error">{error}</p> : null}
  </div>;
}
