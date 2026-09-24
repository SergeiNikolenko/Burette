// Adapt only snapshots owned by the current MVS Story. The source snapshots
// remain intact, so choosing another preset never destroys the authored data.
export function installAutomaticStoryPresentation(plugin, presentation) {
  const state = plugin.state;
  const original = state.setSnapshot;
  const cache = new WeakMap();
  let queue = Promise.resolve();
  const belongsToStory = snapshot => Array.from(plugin.managers.snapshot.state.entries)
    .some(entry => entry.snapshot === snapshot);

  async function apply(snapshot) {
    const settings = presentation.settings();
    // Animated MVS tracks own additional frame trees. This adapter handles
    // ordinary Story steps; never silently flatten a scientific animation.
    if (settings.preset !== 'automatic' || !belongsToStory(snapshot) || !snapshot.data
      || snapshot.startAnimation || snapshot.transition?.frames?.length) {
      return original.call(state, snapshot);
    }
    const canvas = plugin.canvas3d;
    canvas?.pause(true);
    try {
      const cached = cache.get(snapshot);
      const data = cached?.appearance === settings.appearance ? cached.data : undefined;
      // Do not construct the author's molecular geometry just to throw it away
      // for Auto. Keep models/components and non-molecular scientific content.
      const removed = new Set();
      const transforms = snapshot.data.tree.transforms.filter(transform => {
        if (transform.transformer === 'ms-plugin.structure-representation-3d' || removed.has(transform.parent)) {
          removed.add(transform.ref);
          return false;
        }
        return true;
      });
      await original.call(state, {
        ...snapshot,
        data: data || { ...snapshot.data, tree: { ...snapshot.data.tree, transforms } },
        canvas3d: undefined, structureComponentManager: undefined,
        structureFocus: undefined, camera: undefined,
        transition: undefined, startAnimation: false,
      });
      // Set component options BEFORE the standard provider creates geometry.
      await presentation.appearance(settings.appearance);
      if (!data) {
        await presentation.automatic();
        cache.set(snapshot, { appearance: settings.appearance, data: state.data.getSnapshot() });
      }
      await presentation.camera(snapshot.camera);
    } finally {
      canvas?.resume();
      canvas?.requestDraw();
    }
  }

  const wrapped = snapshot => {
    const task = queue.then(() => apply(snapshot));
    queue = task.catch(() => {});
    return task;
  };
  state.setSnapshot = wrapped;
  return () => { if (state.setSnapshot === wrapped) state.setSnapshot = original; };
}
