import { plugin as installPlugin } from "bun";
import { molstarCubeDatasetsPlugin } from "../scripts/molstar-cube-datasets.mjs";
import { molstarCubeUnitsPlugin } from "../scripts/molstar-cube-units.mjs";
// The app's Mol* reads Cube units and interleaved fields with these patches; they load before the fixture's Mol*.
installPlugin(molstarCubeUnitsPlugin); installPlugin(molstarCubeDatasetsPlugin);
const { runReaderTask } = await import("../apps/desktop/src/lib/workbench/reader-task");
const { test, expect, fixture, click, wait, button, act } = await import("./orbitals-runtime-fixture");

// Three orbitals (7, 11, 17) on one 2×1×1 grid, interleaved per point as Gaussian writes them.
const cube = ["Three orbitals", "Known interleaved samples", "-1 1.25 -2.5 3.75", "-2 0.5 0.125 0", "-1 0 0.75 -0.125", "-1 0.25 0 1.5",
  "8 8 2 3 4", "3 7 11 17", "-4 40 400 -3 30 300", ""].join("\n");
const shown = (calls: any[]) => calls.filter(action => action.type === "show_scalar_field" && action.cube);
const choose = async (host: HTMLElement, label: string, value: string) => {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
};

test("a multi-orbital Cube shows the chosen orbital, recolours it without recomputing, and exports that orbital", async () => {
  const view = await fixture(cube);
  try {
    expect([...view.host.querySelectorAll("select[aria-label='Cube field'] option")].map(option => option.textContent)).toEqual(["Orbital 7", "Orbital 11", "Orbital 17"]);
    await choose(view.host, "Cube field", "2");
    await click(view.host, "Show surface"); await wait(() => !button(view.host, "Export Cube").disabled, "orbital 17");
    expect(shown(view.calls).at(-1)).toMatchObject({ label: "Orbital 17", signed: true, positiveColor: 0x3b82f6, negativeColor: 0xef4444 });

    // A new colour resends the same grid through the same binding.
    const bindings = view.calls.filter(action => action.type === "scalar_field_binding").length, grid = shown(view.calls).at(-1).cube;
    await act(async () => view.host.querySelector<HTMLButtonElement>("[aria-label='Positive lobe colour'] [aria-label='Use green']")!.click());
    await wait(() => shown(view.calls).at(-1).positiveColor === 0x22c55e, "recoloured");
    expect(shown(view.calls).at(-1)).toMatchObject({ cube: grid, negativeColor: 0xef4444 });
    expect(view.calls.filter(action => action.type === "scalar_field_binding")).toHaveLength(bindings);
    expect(view.fields()).toBe(1);

    await click(view.host, "Export Cube"); await wait(() => view.saved.length === 1, "export");
    expect(view.saved[0].title).toBe("source-orbital-17.cube");
    const saved = await runReaderTask({ action: "parse", name: "saved.cube", text: view.saved[0].text });
    expect(Array.from(saved.grid!.values)).toEqual([400, 300]);

    // Another orbital is a new field.
    await choose(view.host, "Cube field", "0");
    await wait(() => shown(view.calls).at(-1).label === "Orbital 7", "orbital 7");
    expect(shown(view.calls).at(-1).positiveColor).toBe(0x22c55e);
  } finally { await view.close(); }
});
