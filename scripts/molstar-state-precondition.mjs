import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Version-locked build adaptation, not a global runtime monkey patch. Mol*'s
// normal getTree() reconciliation runs after history bookkeeping has started;
// rejecting there can evict a user's undo entry even without changing the tree.
// Consumers must supply a synchronous read-only assertion: no async callbacks,
// state changes, queued updates, or automatic retry of rejected stale commands.
export function patchMolstarStatePrecondition(source) {
  const head = 'class State {\n';
  const gate = '            if (!removed)\n                return;\n            this._inUpdate = true;';
  if (source.split(head).length !== 2 || source.split(gate).length !== 2
    || source.includes('burettePrecondition')) throw new Error('Mol* state queue layout changed; review conditional-update admission before building.');
  return source.replace(head, `${head}    get burettePreconditionVersion() { return 1; }\n`)
    .replace(gate, `            if (!removed)\n                return;\n            try {\n                if (options?.burettePrecondition) options.burettePrecondition();\n            } catch (error) {\n                this.updateQueue.handled(params);\n                throw error;\n            }\n            this._inUpdate = true;`);
}

export const molstarStatePreconditionPlugin = {
  name: 'molstar-conditional-state-admission',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-state\/state\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* conditional-state adapter before upgrading from 5.11.0.');
      return { contents: patchMolstarStatePrecondition(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
