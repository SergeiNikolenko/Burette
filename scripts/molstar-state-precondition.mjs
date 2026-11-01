import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Version-locked build adaptation, not a global runtime monkey patch. Mol*'s
// normal getTree() reconciliation runs after history bookkeeping has started;
// rejecting there can evict a user's undo entry even without changing the tree.
// Explicit guarded coordinate previews can retain existing history without adding entries.
// Consumers must supply a synchronous read-only assertion: no async callbacks,
// state changes, queued updates, or automatic retry of rejected stale commands.
export function patchMolstarStatePrecondition(source) {
  const head = 'class State {\n';
  const gate = '            if (!removed)\n                return;\n            this._inUpdate = true;';
  const clear = '                        if (!this.undoingHistory)\n                            this.clearHistory();';
  if (source.split(head).length !== 2 || source.split(gate).length !== 2 || source.split(clear).length !== 2
    || source.includes('burettePrecondition')) throw new Error('Mol* state queue layout changed; review conditional-update admission before building.');
  return source.replace(head, `${head}    get burettePreconditionVersion() { return 1; }\n    get buretteKeepHistoryVersion() { return 1; }\n`)
    .replace(gate, `            if (!removed)\n                return;\n            try {\n                if (options?.buretteKeepHistory && typeof options?.burettePrecondition !== 'function') throw new Error('Keeping scene history requires conditional admission.');\n                if (options?.burettePrecondition) options.burettePrecondition();\n            } catch (error) {\n                this.updateQueue.handled(params);\n                throw error;\n            }\n            this._inUpdate = true;`)
    .replace(clear, '                        if (!this.undoingHistory && !options?.buretteKeepHistory)\n                            this.clearHistory();');
}

// Mol* 5.11 turns an object into Null without reporting the object it replaced,
// so listeners keep rendering it: an XYZ frame without a lattice still showed the
// previous frame's cell. Report the released object like a recreate does.
export function patchMolstarNullUpdateRelease(source) {
  const nullCase = '                dispose(transform, current.obj, oldParams, oldCache, ctx.parent.globalContext);\n                current.obj = StateObject.Null;\n                return { ref: currentRef, action: \'updated\', obj: current.obj };';
  const event = "action: 'in-place', obj: update.obj, oldData: update.oldData });";
  if (source.split(nullCase).length !== 2 || source.split(event).length !== 2) throw new Error('Mol* null update layout changed; review released-object events before building.');
  return source.replace(nullCase, '                const oldObj = current.obj;\n                dispose(transform, oldObj, oldParams, oldCache, ctx.parent.globalContext);\n                current.obj = StateObject.Null;\n                return { ref: currentRef, action: \'updated\', oldObj, obj: current.obj };')
    .replace(event, "action: 'in-place', obj: update.obj, oldObj: update.oldObj, oldData: update.oldData });");
}

export const molstarStatePreconditionPlugin = {
  name: 'molstar-conditional-state-admission',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-state\/state\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* conditional-state adapter before upgrading from 5.11.0.');
      return { contents: patchMolstarNullUpdateRelease(patchMolstarStatePrecondition(await readFile(path, 'utf8'))), loader: 'js' };
    });
  },
};
