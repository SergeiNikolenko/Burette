import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerDocument } from "../types";
import type { ShellActions } from "../components/types";
import type { MolecularStructure } from "../lib/molecular-workbench/molecular-graph";
import { usePolymerSource } from "../lib/workbench/polymer-source";
import { runPolymerTask, type PolymerEndGroup, type PolymerResult, type PolymerSettings } from "../lib/workbench/polymer-task";
import { capturePolymerPickOwner } from "./polymer-pick-owner";
import { isAbortError } from "../lib/viewer-errors";

export const POLYMER_ROLES = { head: "Head", headLeaving: "Head H", tail: "Tail", tailLeaving: "Tail H" } as const;
export type PolymerRole = keyof typeof POLYMER_ROLES;
type PickOwner = Awaited<ReturnType<typeof capturePolymerPickOwner>>;
type Ready = { revision: object; graph: MolecularStructure; owner: PickOwner };
const EMPTY_ROLES: Partial<Record<PolymerRole, number>> = {};

export function usePolymerBuilder(document: ViewerDocument | null, actions: Pick<ShellActions, "openStructureRecords">, isCurrent: () => boolean, onDone: () => void) {
  const source = usePolymerSource(document), [reload, setReload] = useState(0);
  const revision = useMemo(() => ({ source: source.revision, reload }), [source.revision, reload]);
  const latestSource = useRef(revision); latestSource.current = revision;
  const [read, setRead] = useState<{ revision: object; ready?: Ready; error?: string } | null>(null);
  const ready = read?.revision === revision ? read.ready : undefined;
  const [picked, setPicked] = useState<{ owner: PickOwner; roles: Partial<Record<PolymerRole, number>> } | null>(null);
  const roles = ready && picked?.owner === ready.owner ? picked.roles : EMPTY_ROLES;
  const [count, setCount] = useState(4), [bondLength, setBondLength] = useState(1.54);
  const [tacticity, setTacticity] = useState<NonNullable<PolymerSettings["tacticity"]> | "picked">("picked");
  const [headEnd, setHeadEnd] = useState<PolymerEndGroup>("hydrogen"), [tailEnd, setTailEnd] = useState<PolymerEndGroup>("hydrogen");
  const [relax, setRelax] = useState(false);
  const key = useMemo(() => ({ ready, roles, count, bondLength, tacticity, headEnd, tailEnd, relax }), [ready, roles, count, bondLength, tacticity, headEnd, tailEnd, relax]);
  const latest = useRef(key); latest.current = key;
  const prepared = useRef<{ key: typeof key; operation: NonNullable<ReturnType<typeof source.prepare>> } | null>(null);
  const pickJob = useRef<AbortController | null>(null), submission = useRef<object | null>(null);
  const [armed, setArmed] = useState<PolymerRole | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [output, setOutput] = useState<{ key: typeof key; result: PolymerResult } | null>(null);
  const preview = output?.key === key ? output.result : null;
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

  useEffect(() => {
    const controller = new AbortController(), capture = source.capture(() => controller.abort()); let owner: PickOwner | undefined;
    const current = () => !controller.signal.aborted && latestSource.current === revision && isCurrent() && Boolean(capture?.isCurrent());
    if (document && capture && source.text !== null && source.format) void (async () => {
      try {
        const graph = await runPolymerTask({ action: "source", text: source.text!, format: source.format! }, { signal: controller.signal });
        owner = await capturePolymerPickOwner(document, { text: source.text!, format: source.format!, atoms: graph.atoms }, current, controller.signal, () => {
          prepared.current?.operation.release(); pickJob.current?.abort();
          if (latestSource.current === revision && isCurrent()) setRead({ revision, error: "The source changed. Pick the atoms again." });
        });
        if (current()) setRead({ revision, ready: { revision, graph, owner } });
      } catch (error) { if (current() && !isAbortError(error)) setRead({ revision, error: errorText(error) }); }
    })();
    return () => { controller.abort(); capture?.release(); owner?.release(); pickJob.current?.abort(); prepared.current?.operation.release(); };
  }, [revision]);
  useEffect(() => { setProblem(null); if (prepared.current?.key !== key) { prepared.current?.operation.release(); prepared.current = null; } }, [key]);

  const pick = async (role: PolymerRole) => {
    if (!ready || busy) return;
    pickJob.current?.abort();
    if (armed === role) { setArmed(null); return; }
    const controller = new AbortController(); pickJob.current = controller; setArmed(role); setProblem(null);
    try {
      const index = await ready.owner.pick(controller.signal);
      if (controller.signal.aborted || latestSource.current !== revision || !ready.owner.isCurrent()) return;
      const { atoms, bonds } = ready.graph, hydrogen = role === "headLeaving" || role === "tailLeaving";
      const attached = (a: number, b: number) => bonds.some(bond => bond.order === 1 && (bond.a === a && bond.b === b || bond.b === a && bond.a === b));
      if (Object.entries(roles).some(([other, value]) => other !== role && value === index)) throw new Error("Choose four different atoms.");
      if (hydrogen) {
        const heavy = roles[role === "headLeaving" ? "head" : "tail"];
        if (atoms[index].element !== "H" || bonds.filter(bond => bond.a === index || bond.b === index).length !== 1
          || !bonds.some(bond => bond.order === 1 && (bond.a === index || bond.b === index))) throw new Error("Pick an explicit singly bonded hydrogen.");
        if (heavy !== undefined && !attached(heavy, index)) throw new Error("Pick the hydrogen bonded to that attachment atom.");
      } else {
        const leaving = roles[role === "head" ? "headLeaving" : "tailLeaving"];
        if (atoms[index].element === "H" || !atoms.some((atom, i) => atom.element === "H" && attached(index, i))) throw new Error("Pick a heavy atom with an explicit hydrogen.");
        if (leaving !== undefined && !attached(index, leaving)) throw new Error("Pick the atom bonded to the chosen hydrogen.");
      }
      setPicked(previous => ({ owner: ready.owner, roles: { ...(previous?.owner === ready.owner ? previous.roles : EMPTY_ROLES), [role]: index } }));
    } catch (error) { if (!controller.signal.aborted && latestSource.current === revision && !isAbortError(error)) setProblem(errorText(error)); }
    finally { if (pickJob.current === controller) { pickJob.current = null; setArmed(null); } }
  };
  const complete = ready && Object.keys(POLYMER_ROLES).every(role => roles[role as PolymerRole] !== undefined);
  const build = async (create: boolean) => {
    if (submission.current || !complete || armed || !ready.owner.isCurrent() || !isCurrent()) return;
    const token = {}; submission.current = token; setBusy(create ? "Creating polymer…" : "Building preview…"); setProblem(null);
    const current = () => latest.current === key && ready.owner.isCurrent() && isCurrent();
    try {
      if (prepared.current?.key !== key) {
        prepared.current?.operation.release();
        const operation = source.prepare({ head: roles.head!, tail: roles.tail!, headLeaving: roles.headLeaving!, tailLeaving: roles.tailLeaving!, count, bondLength,
          endGroups: "hydrogen", ends: { head: headEnd, tail: tailEnd }, relax, ...(tacticity === "picked" ? {} : { tacticity }) }, current);
        if (!operation) return; prepared.current = { key, operation };
      }
      const validate = async () => {
        if (!current()) return false;
        try { return await ready.owner.validate(); }
        catch (error) { if (current()) ready.owner.release(); if (isCurrent() && latestSource.current === revision && latest.current === key) setRead({ revision, error: "The source changed. Pick the atoms again." }); throw error; }
      };
      const operation = prepared.current.operation, result = await operation.build();
      if (!result || !current() || !await validate()) return;
      setOutput({ key, result });
      if (!create) return;
      const opened = await operation.create(actions, validate);
      if (!current()) return;
      if (!opened.length) throw new Error("Could not open the polymer. Try Create again.");
      onDone();
    } catch (error) { if (current() && !isAbortError(error)) setProblem(errorText(error)); }
    finally { if (submission.current === token) { submission.current = null; if (isCurrent()) setBusy(null); } }
  };
  return { ready, roles, armed, pick, build, count, setCount, bondLength, setBondLength, tacticity, setTacticity, headEnd, setHeadEnd, tailEnd, setTailEnd, relax, setRelax, busy, preview,
    complete: Boolean(complete), error: source.error ?? (read?.revision === revision ? read.error : null) ?? problem,
    unavailable: !source.format ? "Open a MOL or SDF repeat unit." : !source.revision.document ? "The source molecule is closed." : null,
    retry: () => setReload(value => value + 1) };
}
