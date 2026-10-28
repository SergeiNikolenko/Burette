// A volume can disappear while the segmentor's queued theme sync is pending.
// The upstream state query assumes its root still exists; return no visuals after
// removal so clear/snapshot replacement can finish without a detached async error.
export function patchMolstarSegmentorLifecycle(source) {
  const before = '  volumeReprsOf(ref) {\n    const state = this.plugin.state.data;\n';
  if (source.split(before).length !== 2 || source.includes('burette-segmentor-lifecycle')) {
    throw new Error('Mol* segmentor changed; review removed-volume theme synchronization.');
  }
  const leftovers = '    const leftovers = this.plugin.state.data.selectQ((q) => q.ofTransformer(BodyMaskFromLabels, ref));';
  if (source.split(leftovers).length !== 2) throw new Error('Mol* segmentor preview cleanup changed.');
  const threshold = '  setThreshold(value) {\n';
  if (source.split(threshold).length !== 2) throw new Error('Mol* segmentor threshold API changed.');
  return source.replace(before, `${before}    // burette-segmentor-lifecycle\n    if (!state.cells.has(ref)) return [];\n`)
    .replace(leftovers, `    if (!this.plugin.state.data.cells.has(ref)) return;\n${leftovers}`)
    .replace(threshold, `  async buretteSetThreshold(value) {\n    this.clearThresholdTimer();\n    this.pendingThreshold = undefined;\n    this.update({ threshold: value });\n    await this.applyThreshold(value);\n  }\n${threshold}`);
}

// CCP4 header NX/NY/NZ describe the full unit-cell sampling, while the loaded
// tensor describes this map's actual extent (including cropped/non-cubic maps).
export function patchMolstarVolumeDimensions(source) {
  const before = 'description: `Volume ${a.data.header.NX}×${a.data.header.NX}×${a.data.header.NX}`';
  if (source.split(before).length !== 2) throw new Error('Mol* CCP4 description changed; review map dimensions.');
  return source.replace(before, 'description: `Volume ${volume.grid.cells.space.dimensions.join("×")}`');
}
