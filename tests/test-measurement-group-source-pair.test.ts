import { expect, test } from "bun:test";
import { prepareMeasurementSourcePair, publishMeasurementSourcePair, measurementPreviewTransfer } from "../apps/desktop/src/lib/workbench/measurement-preview";

test("verified MOL/SDF source pairs retain native group metadata and legacy captures", async () => {
  for (const sourceFormat of ["mol", "sdf"] as const) {
    const id = crypto.randomUUID();
    const pair = await prepareMeasurementSourcePair("source bytes", "edited bytes", 3, sourceFormat);
    publishMeasurementSourcePair(id, pair);
    const group = { isHidden: true, isCollapsed: true, isGhost: true, isLocked: true };
    const items = [{ kind: "Distance", points: [[0], [2]], params: { unitLabel: "Å" } }];
    const capture = { sourceFormat, atomCount: 3, sourceSha256: pair.from, items, group };
    const groupParams = { label: "Authored group 漢字", description: "Keep exact native metadata" };
    const groupTags = ["measurement-group", "group-provenance:session-v2"];
    expect(measurementPreviewTransfer(id, pair.to, { ...capture, groupParams, groupTags })).toEqual({
      version: 1, sourceFormat, targetSourceSha256: pair.to, atomCount: 3, items, group, groupParams, groupTags,
    });
    expect(Object.keys(measurementPreviewTransfer(id, pair.to, capture))).not.toContain("groupParams");
    expect(Object.keys(measurementPreviewTransfer(id, pair.to, capture))).not.toContain("groupTags");
    expect(() => measurementPreviewTransfer(id, pair.to, { ...capture, sourceSha256: "f".repeat(64), groupParams })).toThrow("displayed structure changed");
  }
});
