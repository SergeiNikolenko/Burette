import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const core = resolve(root, 'core');
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: core, stdio: 'inherit' });
execFileSync('wasm-bindgen', ['--target', 'web', '--out-dir', resolve(root, 'src/components/molecular/molecule-editor/core'), '--out-name', 'molecule_editor', resolve(core, 'target/wasm32-unknown-unknown/release/molecule_editor.wasm')], { stdio: 'inherit' });
