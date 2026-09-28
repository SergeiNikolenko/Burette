import { AnimateModelIndex } from 'molstar/lib/mol-plugin-state/animation/built-in/model-index.js';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands.js';
import { StateSelection } from 'molstar/lib/mol-state/index.js';
import { PluginStateObject } from 'molstar/lib/mol-plugin-state/objects.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';

// A fixed stride sharing a divisor with N visits only N/gcd(N, stride) frames.
// At saturation, cap skipping and choose a coprime stride so overload cannot lock the
// viewer into a 2/4-frame orbit. FPS describes source-frame progress, not redraws.
function stride(count, due) {
  const cap = Math.max(1, Math.floor(count / 16));
  let step = Math.max(1, Math.min(cap, Math.floor(due)));
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  if (step === cap) while (step > 1 && gcd(count, step) !== 1) step--;
  return step;
}

const controllers = new WeakMap();
function forPlugin(plugin) {
  if (controllers.has(plugin)) return controllers.get(plugin);
  let pending = Promise.resolve();
  let running = false;
  let beforeFrame = () => {};
  let onError = () => {};
  let onFinished = () => {};
  let modelRef;
  const animation = {
    ...AnimateModelIndex,
    name: 'burette.animate-trajectory',
    display: { name: 'Burette Trajectory' },
    isExportable: false,
    getDuration: () => ({ kind: 'unknown' }),
    initialState: () => ({ carry: 0 }),
    setup() { running = true; },
    async teardown() {
      running = false;
      // Mol* stop alone does not drain applyFrame. Teardown is awaited by stop,
      // so seek/scene replacement cannot race the last coordinate update.
      await pending;
    },
    apply(previous, time, context) {
      if (!running) return Promise.resolve({ kind: 'skip' });
      pending = pending.then(async () => {
        if (!running) return { kind: 'skip' };
        const interval = 1000 / context.params.duration.params.maxFps;
        const elapsed = time.current - time.lastApplied;
        if (time.current > 0 && elapsed < interval) return { kind: 'skip' };
        const due = time.current === 0 ? 1 : previous.carry + elapsed / interval;
        const state = plugin.state.data;
        const models = state.select(StateSelection.Generators.ofTransformer(StateTransforms.Model.ModelFromTrajectory));
        const update = state.build();
        let changed = false;
        for (const model of models) {
          if (model.transform.ref !== modelRef) continue;
          const parent = StateSelection.findAncestorOfType(state.tree, state.cells, model.transform.ref, PluginStateObject.Molecule.Trajectory);
          const count = parent?.obj?.data.frameCount || 0;
          if (count <= 1) continue;
          changed = true;
          update.to(model).update(old => ({ modelIndex: (old.modelIndex + stride(count, due)) % count }));
        }
        if (!changed) { onFinished(); return { kind: 'finished' }; }
        beforeFrame();
        try {
          await PluginCommands.State.Update(plugin, { state, tree: update, options: { doNotLogTiming: true } });
        } finally { beforeFrame(); }
        return { kind: 'next', state: { carry: due % 1 } };
      }).catch(error => {
        running = false;
        onError(error);
        return { kind: 'finished' };
      });
      return pending;
    }
  };
  const controller = {
    animation,
    configure(callbacks) {
      beforeFrame = callbacks.beforeFrame;
      onError = callbacks.onError;
      onFinished = callbacks.onFinished || (() => {});
      modelRef = callbacks.modelRef;
    }
  };
  controllers.set(plugin, controller);
  return controller;
}

export const BuretteTrajectoryPlayback = { forPlugin, stride };
