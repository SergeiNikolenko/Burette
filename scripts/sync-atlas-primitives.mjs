// Extract original component modules, not hand-maintained approximations.
// node scripts/sync-atlas-primitives.mjs --atlas /path/to/InterfaceAtlas
// Add --check to verify source fidelity without rewriting generated modules.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const index = process.argv.indexOf('--atlas');
const check = process.argv.includes('--check');
const atlas = index < 0 ? join(homedir(), 'Documents/Projects/InterfaceAtlas') : process.argv[index + 1];
const shared = 'app-shared-342447930c78.css';
const modules = [
  { name: 'command', sheet: 'app-initial-e55cd978d577.css', bounds: ['.command-menu-dialog{'], names: {
    'global-command-menu-dialog': 'atlas-command-dialog-global',
    'command-menu-dialog': 'atlas-command-dialog',
    '--codex-window-zoom': '--window-zoom',
  } },
  { name: 'dialog-overlay', sheet: shared, bounds: ['._dimmedOverlay_12rau_2{', '._imageOverlay_12rau_2:'], names: {
    _dimmedOverlay_12rau_2: 'atlas-dialog-dimmed-overlay',
  } },
  { name: 'slider', sheet: 'SegmentedControl-1b0cd2c8f252.css', bounds: ['._Slider_pudb7_1{', '._SliderLabel_pudb7_78{'], names: {
    _Slider_pudb7_1: 'atlas-slider', _Track_pudb7_32: 'atlas-slider-track',
    _Range_pudb7_41: 'atlas-slider-range', _Thumb_pudb7_49: 'atlas-slider-thumb',
  } },
  { name: 'select-menu', sheet: 'SegmentedControl-1b0cd2c8f252.css', bounds: ['._MenuList_1rueu_8{', '@media (hover:hover) and (pointer:fine){._SliderWrap'], names: {
    _MenuList_1rueu_8: 'atlas-select-menu', _Menu_1rueu_4: 'atlas-select-transition',
    _MenuInner_1rueu_57: 'atlas-select-menu-inner', _OptionsList_1rueu_74: 'atlas-select-options',
    _Option_1rueu_74: 'atlas-select-option', _PressableInner_1rueu_132: 'atlas-select-pressable',
    _OptionInner_1rueu_136: 'atlas-select-option-inner', _OptionCheck_1rueu_143: 'atlas-select-check',
    _OptionIndicatorSlot_1rueu_150: 'atlas-select-check-slot', _OptionGroupHeading_1rueu_161: 'atlas-select-group-heading',
    _OptionHardLimitHeading_1rueu_179: 'atlas-select-limit-heading', _OptionsLimit_1rueu_188: 'atlas-select-limit',
    _Action_1rueu_196: 'atlas-select-action', _ActionInner_1rueu_261: 'atlas-select-action-inner',
    _ActionsContainer_1rueu_269: 'atlas-select-actions', _Search_1rueu_291: 'atlas-select-search',
    _SearchInput_1rueu_296: 'atlas-select-search-input', _SearchEmpty_1rueu_300: 'atlas-select-search-empty',
    _NativeSelect_1rueu_313: 'atlas-select-native',
    '[data-selected]': '[data-state=checked]', '[data-highlight]': '[data-highlighted]',
    '--radix-popover': '--radix-select',
  } },
  { name: 'select', sheet: 'DatePicker-c4bc775bfdef.css', bounds: ['._SelectControl_1qm03_1{', '._CalendarContainer_1gw5r_1{'], names: {
    _SelectControl_1qm03_1: 'atlas-select', _Clear_1qm03_488: 'atlas-select-clear',
    _DropdownIcon_1qm03_489: 'atlas-select-icon', _TriggerText_1qm03_525: 'atlas-select-text',
    _IndicatorWrapper_1qm03_535: 'atlas-select-indicator', _StartIcon_1qm03_543: 'atlas-select-start-icon',
    _DropdownIconChevron_1qm03_601: 'atlas-select-chevron', _LoadingIndicator_1qm03_607: 'atlas-select-loading',
    '[data-size': '[data-atlas-size',
  } },
  { name: 'button', sheet: shared, bounds: ['._Button_eg66f_2{', '._Tooltip_1cofb_2{'], names: {
    _Button_eg66f_2: 'atlas-button', _ButtonInner_eg66f_2: 'atlas-button-inner', _ButtonLoader_eg66f_2: 'atlas-button-loader',
    '[data-variant': '[data-atlas-variant', '[data-size': '[data-atlas-size',
  } },
  { name: 'checkbox', sheet: 'checkbox-a29fd55a92ab.css', names: {
    _Container_1mw3n_2: 'atlas-checkbox-container', _Checkbox_1mw3n_2: 'atlas-checkbox',
    _CheckMark_1mw3n_2: 'atlas-checkbox-mark', _Label_1mw3n_2: 'atlas-checkbox-label',
  } },
  { name: 'radio-group', sheet: 'radio-group-a33ddfb9ac3b.css', names: {
    _RadioGroup_vttcu_2: 'atlas-radio-group', _RadioLabel_vttcu_2: 'atlas-radio-label',
    _RadioIndicatorWrapper_vttcu_2: 'atlas-radio-wrapper', _RadioItem_vttcu_2: 'atlas-radio-item',
    _RadioIndicator_vttcu_2: 'atlas-radio-indicator', '_fade-in_vttcu_2': 'atlas-radio-fade-in', '_scale-in_vttcu_2': 'atlas-radio-scale-in',
    '[data-direction=col]': '[data-orientation=vertical]',
  } },
  { name: 'loading-indicator', sheet: shared, bounds: ['._LoadingIndicator_mlrw0_1{', '._TransitionGroupChild_nbx58_1{'], names: {
    _LoadingIndicator_mlrw0_1: 'atlas-loading-indicator', _rotate_mlrw0_41: 'atlas-loading-rotate',
  } },
  { name: 'tooltip', sheet: shared, bounds: ['._Tooltip_1cofb_2{', '._TriggerDecorator_1cofb_2{'], names: {
    _Tooltip_1cofb_2: 'atlas-tooltip',
  } },
  { name: 'input', sheet: 'app-initial-e55cd978d577.css', bounds: ['._numberField_1jhuu_11{', '._banner_iwyc9_1{'], names: {
    _numberField_1jhuu_11: 'atlas-input-number',
  } },
  { name: 'toast', sheet: shared, bounds: ['._toast_zsre1_1{', '._background_18gud_1{'], names: {
    _toast_zsre1_1: 'atlas-toast-item', _contents_zsre1_7: 'atlas-toast-contents',
    _alert_zsre1_11: 'atlas-toast', _chatgptSuccess_zsre1_19: 'atlas-toast-success',
  } },
];
for (const { name, sheet, bounds, names } of modules) {
  const source = await readFile(join(atlas, 'snapshot/assets', sheet), 'utf8');
  const start = bounds ? source.indexOf(bounds[0]) : 0;
  const end = bounds?.[1] ? source.indexOf(bounds[1], start) : source.length;
  if (start < 0 || end < 0) throw new Error(`Expected Atlas ${name} module not found`);
  const module = source.slice(start, end);
  if ([...module].reduce((n, c) => n + (c === '{' ? 1 : c === '}' ? -1 : 0), 0) !== 0) {
    throw new Error(`${name} extraction crosses a stylesheet boundary`);
  }
  const digest = createHash('sha256').update(module).digest('hex');
  let css = module;
  for (const [original, local] of Object.entries(names)) {
    if (!css.includes(original)) throw new Error(`Missing ${name} symbol ${original}`);
    css = css.replaceAll(original, local);
  }
  css = css.replaceAll('}', '}\n');
  if (bounds) css = `@layer components {\n${css}}\n`;
  const output = `/* Generated by scripts/sync-atlas-primitives.mjs. Do not edit.
 * Source: InterfaceAtlas snapshot/assets/${sheet}, ${name} module.
 * Source module SHA-256: ${digest}
 * Only class/keyframe names and Burette's mapped attributes differ.
 */\n@layer theme, base, components, utilities;\n${css}`;
  const target = new URL(`../apps/desktop/src/components/ui/${name}.atlas.css`, import.meta.url);
  // Unchanged modules must not reload every open preview during a focused sync.
  let previous;
  try { previous = await readFile(target, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous !== output) {
    if (check) {
      console.error(`Atlas ${name} differs from its source; run scripts/sync-atlas-primitives.mjs to regenerate.`);
      process.exitCode = 1;
    } else await writeFile(target, output);
  }
  console.log(`Original Atlas ${name}: ${module.length} bytes, SHA-256 ${digest}`);
}
