import { useEffect, useState } from "react";
import type { CrystalEdit } from "../../lib/molecular-workbench/crystal-edit";
import type { CrystalFormat } from "../../lib/molecular-workbench/crystal-io";
import { SYMMETRY_TOLERANCE, type SpaceGroupSetting, type SymmetryAnalysis } from "../../lib/molecular-workbench/crystal-symmetry";
import { runCrystalTask } from "../../lib/workbench/crystal-task";
import { chemistryError } from "../../lib/workbench/structure";
import type { CrystalRevision } from "../../lib/workbench/use-crystal-draft";
import { isAbortError } from "../../lib/viewer-errors";
import { Button } from "../ui/button";
import { CollapsibleSection } from "../ui/collapsible-section";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";

/** Settle time after the last tolerance change before the cell is analysed again. */
const ANALYSIS_DELAY_MS = 150;
const SITE_ROWS = 60;

let settings: Promise<SpaceGroupSetting[]> | null = null;
/** All 530 Hall settings, read once from the symmetry engine. */
function spaceGroupSettings() {
  settings ??= runCrystalTask({ action: "space-groups" }).catch((error) => { settings = null; throw error; });
  return settings;
}

const settingLabel = (setting: SpaceGroupSetting) => `${setting.number} ${setting.symbol}${setting.setting ? ` (${setting.setting})` : ""}`;

/**
 * Space group of the current cell at a chosen tolerance, and the edits that follow from
 * it: primitive, conventional, symmetrized and asymmetric-unit cells, or the cell filled
 * by the operations of any space-group setting.
 */
export function CrystalSpaceGroupSection({ format, revision, disabled, apply }: {
  format: CrystalFormat; revision: CrystalRevision; disabled: boolean; apply: (edit: CrystalEdit) => Promise<void>;
}) {
  const [tolerance, setTolerance] = useState<number>(SYMMETRY_TOLERANCE.default);
  const [draftTolerance, setDraftTolerance] = useState<number>(SYMMETRY_TOLERANCE.default);
  const key = `${revision.id}:${tolerance}`;
  const [analysis, setAnalysis] = useState<{ key: string; result: SymmetryAnalysis | null; error: string | null } | null>(null);
  const [groups, setGroups] = useState<SpaceGroupSetting[] | null>(null);
  const [hallNumber, setHallNumber] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      runCrystalTask({ action: "analyze", source: { format, text: revision.text }, tolerance }, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setAnalysis({ key, result, error: null }); })
        .catch((error) => { if (!controller.signal.aborted && !isAbortError(error)) setAnalysis({ key, result: null, error: chemistryError(error) }); });
    }, ANALYSIS_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key]);
  useEffect(() => {
    let current = true;
    spaceGroupSettings().then((value) => { if (current) setGroups(value); }).catch(() => {});
    return () => { current = false; };
  }, []);
  const current = analysis?.key === key ? analysis : null;
  const result = current?.result ?? null;
  const fill = hallNumber ?? result?.hallNumber ?? 1;
  const symmetry = (kind: "primitive" | "conventional" | "symmetrize" | "asymmetric-unit") => () => void apply({ kind, tolerance });
  return (
    <CollapsibleSection title="Space group" detail={result ? `${result.symbol} (${result.number})` : undefined}>
      <div className="workbench-form">
        <div className="workbench-row">
          <label className="workbench-field">
            <span>Tolerance, Å</span>
            <ScrubNumberField aria-label="Tolerance, Å" name="symmetry-tolerance" autoComplete="off" value={draftTolerance} min={SYMMETRY_TOLERANCE.min} max={SYMMETRY_TOLERANCE.max}
              step={0.001} largeStep={0.01} formatValue={(value) => value.toFixed(4)}
              onValueChange={setDraftTolerance} onValueCommitted={(value) => { setDraftTolerance(value); setTolerance(value); }} />
          </label>
          {!current ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Analyzing</span> : null}
        </div>
        {current?.error ? <p role="alert" className="workbench-error">{current.error}</p> : null}
        {result ? (
          <>
            <dl className="workbench-properties">
              <div><dt>Space group</dt><dd>{result.symbol} ({result.number})</dd></div>
              <div><dt>Crystal system</dt><dd className="capitalize">{result.crystalSystem}</dd></div>
              <div><dt>Operations</dt><dd>{result.operationCount.toLocaleString("en-US")}</dd></div>
              <div><dt>Primitive cell</dt><dd>{result.primitive.atomCount.toLocaleString("en-US")} atoms</dd></div>
              <div><dt>Conventional cell</dt><dd>{result.conventional.atomCount.toLocaleString("en-US")} atoms</dd></div>
            </dl>
            <div className="crystal-sites">
              <table className="workbench-table" aria-label="Symmetry-distinct sites">
                <thead><tr><th scope="col">Site</th><th scope="col">Wyckoff</th><th scope="col">Symmetry</th><th scope="col">Atoms</th></tr></thead>
                <tbody>
                  {result.sites.slice(0, SITE_ROWS).map((site) => (
                    <tr key={site.label}><th scope="row">{site.label}</th><td>{site.wyckoff}</td><td>{site.siteSymmetry}</td><td>{site.count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.siteCount > SITE_ROWS ? <span className="workbench-value">{`${SITE_ROWS} of ${result.siteCount} sites`}</span> : null}
          </>
        ) : null}
        <div className="workbench-row">
          <Button type="button" size="xs" variant="secondary" disabled={disabled || !result} onClick={symmetry("primitive")}>Primitive</Button>
          <Button type="button" size="xs" variant="secondary" disabled={disabled || !result} onClick={symmetry("conventional")}>Conventional</Button>
          <Button type="button" size="xs" variant="secondary" disabled={disabled || !result} onClick={symmetry("symmetrize")}>Symmetrize</Button>
          <Button type="button" size="xs" variant="secondary" disabled={disabled || !result} onClick={symmetry("asymmetric-unit")}>Asymmetric unit</Button>
        </div>
        <div className="workbench-row">
          <label className="workbench-field crystal-fill-group">
            <span>Fill with</span>
            <NativeSelect size="sm" aria-label="Fill with space group" name="fill-space-group" value={String(fill)} disabled={!groups}
              onChange={(event) => setHallNumber(Number(event.currentTarget.value))}>
              {(groups ?? []).map((group) => <NativeSelectOption key={group.hallNumber} value={String(group.hallNumber)}>{settingLabel(group)}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <Button type="button" size="xs" variant="secondary" disabled={disabled || !groups} onClick={() => void apply({ kind: "fill", hallNumber: fill })}>Fill unit cell</Button>
        </div>
      </div>
    </CollapsibleSection>
  );
}
