import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler-api";
import type { HtmlTagDescriptor, Plugin } from "vite";
import { recolorKetcherCss } from "./ketcher-palette.ts";
import { scopeKetcherKeyboard } from "./ketcher-keyboard.ts";
import { ketcherMacroTheme } from "./ketcher-macro-theme.ts";

// Ketcher 3.18 publishes one UI bundle and has no component-slot API. Replace only
// its shared presentation primitives; retain the original form codecs, Redux
// actions, chemistry services, and canvas. Hash each boundary so an upstream
// update cannot silently bind a different component to the old prop contract.
const primitives = {
  "Atom$1": ["KetcherPeriodicElementButton", "127ae6a796da768b8b83674b7ccdf92acb421d0a6a0ae6d1c3b3aba8498ae04d"],
  TypeChoice: ["KetcherElementChoice", "1153e38366ff4291b8345ac7686ee09c6b1be9eaf0d237f004c2ac69580d751e"],
  ToolbarMultiToolItem: ["KetcherMicroToolMenu", "65d6919047397da37f95bdb681554beae7872aedc973ab62dd6ef2a7e9d66345", "micro-tools"],
  NaturalAnaloguePicker: ["KetcherNaturalAnaloguePicker", "a4b525c9433ab0a132b538959f8909415704c07b9e7a7f2967f948a73a487266", "analogue"],
  ModeControl: ["KetcherModeMenu", "0595ccc27d93ef843dedcd37b832887671463c2f84512e808c8fb021187e863d", "mode"],
  MenuItemWithDropdown: ["KetcherCopyMenu", "c01a0a837d6a9863f32b867db05cb6b60f1fbc91158406794430ad456bc90206", "copy"],
  StyledInput: ["KetcherInput", "713dbc0d1379c92a6da292030f8864d8a110ec2136857e3432b9da377f15bd03"],
  ZoomControls: ["KetcherZoomMenu", "ead5dcc2dace52301377a46d27581e0659c15e0305d4a7d8876fff4481ae9485", "zoom"],
  ActionButton: ["KetcherToolButton", "0bf094cdb48eba39761058ed55e8d6dc010079152d737e1c74584d7f312da1b8", "element"],
  AtomsList: ["KetcherAtomButton", "603720925102ec876c65c95b20617e4dda9cb00a383d90562185056ec33e0069", "atoms"],
  ButtonGenSet: ["KetcherChemicalButton", "4dac4a03be0bf4afc98ab622e0cb0375c522b2a463fec19dced17ac3ff38e322", "element"],
  TextButton: ["KetcherToolButton", "f9fec33c55fb053d6d542533ea17b10b7d4f89b611bf48cb17447dfea25b3c6f", "element"],
  Atom: ["KetcherToolButton", "f843a5d6b69ec115ec17940d988d90ecffe9fcbefe49dff5e038e9cba4e335d9", "element"],
  IconButtonBase: ["KetcherIconButton", "144231e80ffa149a5b2c9018262b0c03b3107a4124f2aab63e5b2abd1d445881"],
  Button: ["KetcherButton", "4ba70e36710083309f326cce3514c2e1f25ab46abbfc97f2abd49ce2c4ecf9d9"],
  "Input$2": ["KetcherInput", "d250e7dc2092c637e421af76e4000c322f6f52622e97172d4c91524374dca03a"],
  "Accordion$1": ["KetcherAccordion", "c79c2a51649129de971bdacb0619287ecbebb9aa003332a92a29099e7951c197"],
  Accordion: ["KetcherSettingsAccordion", "217219ed6913843389f2290bcbc91fb7c2f5aa2e7dd23cfeb3d1d5ff5f46a029"],
  Dialog: ["KetcherDialog", "e68d8ba5dca7061f3cd93629366d2955de49ea6c0f2d24986ecb6c2e47f176e5"],
  "Select$1": ["KetcherSelect", "1a2ec0e062b663058bd738ea614316499391d59f34c555e5c33f73a5685e4f8a"],
  GenericInput: ["KetcherGenericInput", "477ced5e608e73181b128caf33bfc3b697ce1c291e39c73d6a4458d7d1e87076"],
  TextArea: ["KetcherTextarea", "4324eebe1e8a58e54bf2d03d261ff72b713ad051fbab4ac86f5c7d60309d2c90"],
  CheckBox: ["KetcherCheckbox", "11323478b58a067f831afbbf7a0a40d948b83b08b0afb1fa01429d3ab7454d42"],
  Slider: ["KetcherSwitch", "4295b1ff55d2c1583767035192781769e5e54ee2a7fed60cde3925f17c0842e7"],
  MiewDialog: ["Molecule3dPreview", "0274b7cc622d35bc90cb6e89837a3d17a2a18731c24e5f90a6fc3382c8a99c64", "molecule-3d"],
  Tabs: ["KetcherTabs", "6e7015fc45bc311802265fadcaf62a32d1b818b2c0225eb4f20e44dd64f08005"],
} as const;

const macroPrimitives = {
  SubMenu: ["KetcherMacroToolMenu", "205a773456918414949090541c7223b78a2477603202cf255f8fd7c3ae6651d5", "tools"],
  MenuItem: ["KetcherMacroMenuItem", "0d153d1201f708a98fe624c537ad49d4a232049d92283bfaa04c9c606867fdd6", "tool-item"],
  StyledInput: ["KetcherInput", "a41ff625ace21d9407a1231af73bacc96ed6f4ef10b4cabeba2b09018ff17f31"],
  ZoomControls: ["KetcherZoomMenu", "3de482e34c4d475cde51f8f02ff6ebbd8c5218cbd3f0a0da88c51b78106dc0db", "zoom"],
} as const;

function guardInitialCanvasWheel(code: string) {
  // Wheel input can precede the first pointer event. Keep native pan/zoom and
  // replay hover only after the canvas has a pointer position to replay.
  const replay = "(_this$editor$tool = _this.editor.tool()) === null || _this$editor$tool === void 0 || (_this$editor$tool$mou = _this$editor$tool.mousemove) === null || _this$editor$tool$mou === void 0 || _this$editor$tool$mou.call(_this$editor$tool, _this.editor.lastEvent);";
  if (code.split(replay).length !== 2) throw new Error("Ketcher canvas wheel contract changed.");
  return code.replace(replay, `if (_this.editor.lastEvent) { ${replay} }`);
}

// Avoid mounting the hidden macromolecules editor when the host disables it, and
// pass the Atlas token theme to the one it mounts. Keep 3.18's modular core and
// native monomer data intact for all chemistry APIs.
function skipDisabledMacromoleculesEditor(code: string) {
  const mount = "children: ketcherId && jsx(MacromoleculesEditorComponent, {";
  if (code.indexOf(mount) < 0 || code.indexOf(mount) !== code.lastIndexOf(mount)) {
    throw new Error("Ketcher macromolecules editor mount changed.");
  }
  return code.replace(mount, `children: !props.disableMacromoleculesEditor && ketcherId && jsx(MacromoleculesEditorComponent, {\n          theme: ${JSON.stringify(ketcherMacroTheme)},`);
}

// React writes the RNA builder slot's `selected` prop as a DOM property, so CSS
// cannot see it. Mirror it into an attribute the workspace stylesheet can match.
function markSelectedRnaBuilderSlots(code: string) {
  for (const container of ["GroupBlockContainer", "CompactGroupBlockContainer"]) {
    const slot = `jsx(${container}, {\n    selected: selected,`;
    if (code.indexOf(slot) < 0 || code.indexOf(slot) !== code.lastIndexOf(slot)) {
      throw new Error(`Ketcher RNA builder slot contract changed: ${container}.`);
    }
    code = code.replace(slot, `${slot}\n    "data-selected": selected ? "" : undefined,`);
  }
  return code;
}

// The macromolecules UI puts native `title` tooltips on its buttons, tabs and
// fields. Wrap each titled element in the bundle's Tooltip import, which the
// transform points at the Atlas adapter, and keep the text as the accessible
// name unless the element has visible text or its own label. Elements listed per
// declaration; component props named `title` (dialog headings) stay untouched.
const macroTitleContracts: Record<string, readonly [string, readonly string[], { tooltip?: string; label?: false }?]> = {
  Tabs: ["13dd6f5bff42cfdd27539656cf4efd8e1bc352769d30225412463bbd16044c05", ["StyledTab"]],
  RnaEditorCollapsed: ["0936050b686f60cadcbd951537c8cd76abde0411aae54b8eead901b44b72f540", ["RnaEditorCollapsedContainer", "MonomerName$3"], { label: false }],
  Modal: ["b72b7563a62054dd0f14b9b6889d3ab59ade802a2a3d7617db8debcaa8a0e012", ["IconButton$1"]],
  // Text buttons: show only an explicit caller title, never the visible label.
  ActionButton: ["7ce7a194a8eaa9e8993f6d74bdf50c50e733fbcd2bbb5ef90bdbb9197f73b979", ["SecondaryButton", "PrimaryButton"], { tooltip: "rest.title", label: false }],
  RnaElementsTabsView: ["8d6bf27730005753712f96035fd1bc07c014ee90bce85a0ceb118efd60a2554e", ["RnaTab"]],
  MonomerLibrary: ["838cdf7bab4f03341e86f912a115f826ae6e6fa668afd3b8845ccb5b3a9f1736", ["MonomerLibraryToggle$1"]],
  Settings: ["c72bee5dfae5a82677807d48e18428b7f13ae17a95887e079fa4c143fbb7f517", ["HeaderButton"]],
  PresetPreview: ["0093c0d51140cab29209f67dfa7fd82b3e387cbd844b443a220029f4d3a981b0", ["PhosphatePositionIconWrapper"]],
  SequenceTypeGroupButton: ["ed735c25b4529f2e1e3c39c47d49ac62cc520c247e5acb4a7c9ee541ff007b68", ["SequenceTypeButton"]],
  CalculateMacromoleculePropertiesButton: ["20ab25c82f200c3cdeb4bca1ef503b0166526658f0aebcfa584e8015cafd6447", ["StyledButton$1"]],
  RulerInput: ["7fb1a3ab0c8e53bdd0cda686192535fe4847de75550a2efc9fc00b1e4bc9aaa7", ["\"input\""]],
  FloatingTools: ["7f92a88e2108d5ae8eab0faeaa1a58b3c27c72bb9c5512f49b4256da94190b53", ["ToolButton"]],
};
function adaptMacroTitles(code: string, tooltipModulePath: string) {
  const tooltipImport = "import Tooltip, { tooltipClasses } from '@mui/material/Tooltip';";
  if (code.split(tooltipImport).length !== 2) throw new Error("Ketcher macromolecules tooltip import changed.");
  const source = ts.createSourceFile("macro.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const found = new Set<string>();
  // Props are a literal, or Babel's _objectSpread over a literal and a rest object.
  const literal = (node: ts.Expression): ts.ObjectLiteralExpression | undefined => ts.isObjectLiteralExpression(node) ? node
    : ts.isCallExpression(node) && /^_objectSpread/u.test(node.expression.getText(source)) && node.arguments[0] ? literal(node.arguments[0]) : undefined;
  const property = (owner: ts.ObjectLiteralExpression, name: string) => owner.properties.find((item): item is ts.PropertyAssignment =>
    ts.isPropertyAssignment(item) && item.name.getText(source) === name);
  for (const statement of source.statements) {
    const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : ts.isFunctionDeclaration(statement) ? [statement] : [];
    for (const declaration of declarations) {
      const name = declaration.name?.getText(source);
      if (!name || !Object.hasOwn(macroTitleContracts, name)) continue;
      const [hash, elements, options = {}] = macroTitleContracts[name];
      const node = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration.body;
      if (!node || createHash("sha256").update(node.getText(source)).digest("hex") !== hash || found.has(name)) {
        throw new Error(`Ketcher macromolecules title contract changed: ${name}.`);
      }
      found.add(name);
      const matched = new Set<string>();
      const visit = (call: ts.Node) => {
        ts.forEachChild(call, visit);
        if (!ts.isCallExpression(call) || !/^jsxs?$/u.test(call.expression.getText(source)) || call.arguments.length < 2) return;
        const element = call.arguments[0].getText(source);
        const props = call.arguments[1];
        const owner = literal(props);
        const title = owner && property(owner, "title");
        if (!elements.includes(element) || !owner || !title) return;
        matched.add(element);
        const text = title.initializer.getText(source);
        const comma = code[title.end] === ",";
        // An element with its own label sits inside a titled parent: drop its title only.
        if (property(owner, '"aria-label"')) {
          edits.push({ start: title.getStart(source), end: title.end + (comma ? 1 : 0), text: "" });
          return;
        }
        const visibleText = property(owner, "children")?.initializer;
        const label = options.label !== false && !(visibleText && ts.isStringLiteral(visibleText));
        edits.push({ start: title.getStart(source), end: title.end + (comma ? 1 : 0), text: label ? `"aria-label": ${text}${comma ? "," : ""}` : "" });
        const spread = owner !== props;
        const key = call.arguments[2];
        edits.push({ start: call.getStart(source), end: call.getStart(source), text: `jsx(Tooltip, { title: ${options.tooltip ?? text}, children: ` });
        if (spread) edits.push({ start: props.getStart(source), end: props.getStart(source), text: "{ ...(" });
        // A spread rest object may carry the title again; the key moves to the wrapper.
        if (spread || key) edits.push({ start: props.end, end: key ? key.end : props.end, text: spread ? "), title: undefined }" : "" });
        edits.push({ start: call.end, end: call.end, text: key ? ` }, ${key.getText(source)})` : " })" });
      };
      visit(node);
      if (matched.size !== elements.length) throw new Error(`Ketcher macromolecules titled element missing: ${name}.`);
    }
  }
  if (found.size !== Object.keys(macroTitleContracts).length) throw new Error("Ketcher macromolecules titled components missing.");
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code.replace(tooltipImport, `import { tooltipClasses } from '@mui/material/Tooltip';\nimport { KetcherMacroTooltip as Tooltip } from ${JSON.stringify(tooltipModulePath)};`);
}

// Retain Lexical's style/insertion callbacks and native symbol/preset data.
// Only the annotation menus and field-label presentation leave the bundle.
const annotationContracts: Record<string, string> = {
  FontControl: "b0f1fa8dafc95f6ccff65aa583ec4f197b7bc43b27a034e5ecdcec22d63679b0",
  SpecialSymbolsButton: "f03a6e21e6ccd237e705f81aeec4561a95ba64797a979ee11eb0017ca49c97f7",
  SpecialSymbolsList: "cd7f03ba28dd180871af1df07b377e1a78293314963c711e7231b2b452b285a7",
  ColorPicker: "cb141dc49f53ec347d242a4abc3764a2d49a797163b166b15d1441fd55aa4d78",
  renderLabelContent: "c20bf376d038c0c80ce2b4d4153a99c68b9fca36e6473dcf07dd5df2dfb26a5e",
  renderLabelContentAfter: "51af0fa47cba341a8c783e200bc32fc6916738d46e9a3d3baad3f2534bbc882c",
};
function adaptAnnotationControls(code: string) {
  const source = ts.createSourceFile("annotations.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const statement of source.statements) {
    for (const declaration of ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement]) {
      if (!ts.isVariableDeclaration(declaration) && !ts.isFunctionDeclaration(declaration)) continue;
      const name = declaration.name?.getText(source);
      if (!name || !Object.hasOwn(annotationContracts, name)) continue;
      const node = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration.body;
      if (!node || createHash("sha256").update(node.getText(source)).digest("hex") !== annotationContracts[name]) throw new Error(`Ketcher annotation contract changed: ${name}.`);
      let text: string;
      if (name.startsWith("renderLabelContent")) {
        text = `{ return jsx(__buretteKetcherFieldLabel, { title, tooltip, after: ${name.endsWith("After")} }); }`;
      } else if (name === "ColorPicker") {
        text = "function ColorPicker(props) { return jsx(__buretteKetcherColorPicker, { ...props, colors: presetColors, Picker: HexColorPicker }); }";
      } else {
        if (!ts.isFunctionExpression(node)) throw new Error(`Ketcher annotation render changed: ${name}.`);
        const rendered = node.body.statements.findLast(ts.isReturnStatement);
        if (!rendered) throw new Error(`Ketcher annotation render missing: ${name}.`);
        text = node.getText(source).slice(0, rendered.getStart(source) - node.getStart(source));
        if (name === "SpecialSymbolsList") {
          text += "return jsx(__buretteKetcherSymbolItems, { symbols, onSelect, renderSymbol: function(symbol) { return jsx(Icon, { name: symbol }); } });\n}";
        } else {
          // Opening a keyboard-focusable popup must not lose the selected text.
          // Keep its cloned Lexical range, then restore inside the original edit.
          text = text.replace("var editor = _ref.editor;", `var editor = _ref.editor;
  var savedSelection = useRef(null);
  var captureSelection = function() { editor.getEditorState().read(function() { var selection = $getSelection(); if ($isRangeSelection(selection)) savedSelection.current = selection.clone(); }); };
  useEffect(function() { return editor.registerUpdateListener(function(update) { update.editorState.read(function() { var selection = $getSelection(); if ($isRangeSelection(selection)) savedSelection.current = selection.clone(); }); }); }, [editor]);
  var returnFocus = function() { editor.update(function() { if (!$getSelection() && savedSelection.current) $setSelection(savedSelection.current.clone()); }); editor.focus(); };`);
          text = text.replace("editor.update(function () {\n      var selection = $getSelection();", "editor.update(function () {\n      if (savedSelection.current) $setSelection(savedSelection.current.clone());\n      var selection = $getSelection();");
          if (name === "FontControl") {
            text = text.replace("  useClickOutside(wrapperRef, onClickOutsideCloseDrowndown);\n", "");
            text += `return jsx(__buretteKetcherFontMenu, { value: currentFontSize, sizes: fontSizes, open: isShowingFontSizeMenu,
  onOpenChange: function(next) { if(next) captureSelection(); setIsShowingFontSizeMenu(next); },
  onSelect: function(value) { setFontSize({ preventDefault: function() {} }, value + 'px'); }, onReturnFocus: returnFocus });\n}`;
          } else {
            text += `return jsx(__buretteKetcherSymbolsMenu, { open: showSpecialSymbols,
  onOpenChange: function(next) { if(next) captureSelection(); setShowSpecialSymbols(next); },
  onReturnFocus: returnFocus, icon: jsx(Icon, { name: 'text-special-symbols' }), children: jsx(SpecialSymbolsList, { onSelect: addSymbol }) });\n}`;
          }
        }
      }
      edits.push({ start: node.getStart(source), end: node.end, text });
    }
  }
  if (edits.length !== Object.keys(annotationContracts).length) throw new Error("Ketcher annotation components missing.");
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  const lexicalImport = "import { $getSelection, $isRangeSelection, $getRoot, FORMAT_TEXT_COMMAND, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical';";
  if (code.split(lexicalImport).length !== 2) throw new Error("Ketcher Lexical import changed.");
  return code.replace(lexicalImport, lexicalImport.replace("$getSelection,", "$getSelection, $setSelection,"));
}

const chemicalSurfaceContracts: Record<string, string> = {
  FooterContent$1: "d2a6114e052a7b0e268c8f0822f87578eaf2e035ff2bd6dd6c8a6afbe424a3b1",
  OpenOptions: "11f829a09f5e712efe3ef0c6bd3b78c45a165f1f956e1ba2750c9095e3caa457",
  FileDrop: "0b8a10f82567b75577b6f73d2c87a27f70fde129494b79f350cad97e988caab9",
  CDXStructuresViewer: "478503b4486e3e5fd86d5924bf9012e2f4d72be4177cf86a4f1b1d644bca32f0",
  InfoPanel: "0c830b1c8f61e3fbb61b3e3c00891b784f4d687e3324b996cf37fabba156ef82",
  SGroupDataRender: "93dbae7986152cde15d1effa54062927fb433e5102b0206f7f9642c9c0eee47e",
  InfoTooltip: "4262cd3b1f679876755570e656325c7be27f21ff66546c37e5f757ddfa61f219",
};
function adaptChemicalSurfaces(code: string) {
  const source = ts.createSourceFile("chemical-surfaces.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(source);
      if (!Object.hasOwn(chemicalSurfaceContracts, name)) continue;
      const node = declaration.initializer;
      if (!node || !ts.isFunctionExpression(node) || createHash("sha256").update(node.getText(source)).digest("hex") !== chemicalSurfaceContracts[name]) throw new Error(`Ketcher chemical surface contract changed: ${name}.`);
      let text = node.getText(source);
      if (name === "FooterContent$1") {
        const rendered = node.body.statements.findLast(ts.isReturnStatement);
        if (!rendered) throw new Error("Ketcher Open footer render missing.");
        text = text.slice(0, rendered.getStart(source) - node.getStart(source)) + `return jsx(__buretteKetcherImportActions, { structStr, openHandler, copyHandler, onCancel, isAddToCanvasDisabled });\n}`;
      } else if (name === "OpenOptions") {
        const rendered = node.body.statements.findLast(ts.isReturnStatement);
        if (!rendered) throw new Error("Ketcher Open options render missing.");
        text = text.slice(0, rendered.getStart(source) - node.getStart(source)) + `return jsx(__buretteKetcherImportOptions, {
  onPaste: selectClipboard,
  file: jsx(FileDrop, { onDropAccepted: fileLoadHandler, onDropRejected: function(e) { return errorHandler('Unable to accept file(s). ' + e); }, buttonLabel: 'Open from file', iconName: ICON_NAMES.FILE, testId: 'open-from-file-button' }),
  image: jsx(FileDrop, { accept: 'image/*', disabled: isRecognizeDisabled, onDropAccepted: imageLoadHandler, onDropRejected: function() { return errorHandler('Unable to accept file(s). Make sure you upload 1 image.'); }, buttonLabel: 'Open from image', iconName: ICON_NAMES.IMAGE, testId: 'open-from-image-button' })
});\n}`;
      } else if (name === "FileDrop") {
        const renderStart = node.body.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === "getClassesString"));
        if (!renderStart) throw new Error("Ketcher file-drop render missing.");
        text = text.slice(0, renderStart.getStart(source) - node.getStart(source)) + `return jsx(__buretteKetcherImportDropzone, {
  rootProps: getRootProps({ role: 'group', tabIndex: -1 }), inputProps: getInputProps(),
  buttonLabel, disabled, active: isDragActive, testId, image: iconName === 'image-frame'
});\n}`;
      } else if (name === "CDXStructuresViewer") {
        const renderStart = node.body.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === "renderStructure"));
        if (!renderStart) throw new Error("Ketcher CDX preview render missing.");
        // Keep parsing, selection, cached actual Structs and base64 forwarding.
        text = text.slice(0, renderStart.getStart(source) - node.getStart(source)) + `return jsx(__buretteKetcherImportStructures, {
  fileName, count: structList.length, selectedIndex, onSelect: setSelectedIndex,
  items: itemsMap, loading, Renderer: StructRender,
  options: { ...editorOptions, autoScale: true, needCache: false }
});\n}`;
      } else {
        // Keep native coordinates, S-group classification/cloning, real preview
        // options and escaped chemical text. Replace only each final surface.
        const rendered = node.body.statements.findLast(ts.isReturnStatement);
        if (!rendered) throw new Error(`Ketcher chemical surface render missing: ${name}.`);
        const tail = rendered.getText(source);
        if (tail.split('jsx("div", {').length !== 2) throw new Error(`Ketcher chemical surface leaf changed: ${name}.`);
        text = text.slice(0, rendered.getStart(source) - node.getStart(source)) + tail.replace('jsx("div", {', 'jsx(__buretteKetcherChemicalInfoSurface, {') + "\n}";
        if (name === "InfoTooltip") text = text.replace("document.removeEventListener('mouseover', toggleTooltip);", "document.removeEventListener('mouseover', toggleTooltip); debouncedShowTooltip.cancel();");
      }
      edits.push({ start: node.getStart(source), end: node.end, text });
    }
  }
  if (edits.length !== Object.keys(chemicalSurfaceContracts).length) throw new Error("Ketcher chemical surfaces missing.");
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code;
}

function adaptStructureLibrary(code: string) {
  const source = ts.createSourceFile("library.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const contracts = {
    TemplateTable: "a9d7ba9c916ac0e313bd023aeede78fdb73fd1c02751b03c588cb650eaa2953e",
    TemplateDialog: "0d2db1e2f348ccbab97678409e4231184173b986704f81df86060de2e487b1e5",
  };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(source);
      if (name !== "TemplateTable" && name !== "TemplateDialog") continue;
      const node = declaration.initializer;
      if (!node || createHash("sha256").update(node.getText(source)).digest("hex") !== contracts[name]) {
        throw new Error(`Ketcher structure library contract changed: ${name}.`);
      }
      const before = name === "TemplateTable"
        ? "children: [jsx(StructRender, {"
        : "var data = sdfSerializer.serialize(serializerMapper[tab]);";
      const after = name === "TemplateTable"
        ? "children: [jsx(__buretteKetcherLibraryPreview, { renderer: StructRender,"
        : "var data = useMemo(function () { return sdfSerializer.serialize(serializerMapper[tab]); }, [tab, templateLib, functionalGroups, saltsAndSolvents]);";
      const text = node.getText(source);
      if (text.split(before).length !== 2) throw new Error(`Ketcher structure library boundary missing: ${name}.`);
      let adapted = text.replace(before, after);
      if (name === "TemplateTable") {
        // A template also contains edit/delete buttons. Keep them independent
        // keyboard targets instead of nesting native buttons inside a button.
        adapted = adapted.replace('return jsxs("button", {\n        type: "button",', 'return jsxs("div", {\n        role: "button", tabIndex: 0,\n        onKeyDown: function (event) { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(tmpl); } },');
        adapted = adapted.replace('"data-testid": \'edit-template-button\',', '"data-testid": \'edit-template-button\', "aria-label": "Edit template",');
        adapted = adapted.replace('"data-testid": \'delete-template-button\',', '"data-testid": \'delete-template-button\', "aria-label": "Delete template",');
      }
      edits.push({ start: node.getStart(source), end: node.end, text: adapted });
    }
  }
  if (edits.length !== 2) throw new Error("Ketcher structure library components missing.");
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code;
}

export function ketcherUiPlugin(): Plugin {
  const modulePath = fileURLToPath(new URL("../src/components/ketcher/primitives.tsx", import.meta.url));
  const menuModulePath = fileURLToPath(new URL("../src/components/ketcher/menus.tsx", import.meta.url));
  const contextModulePath = fileURLToPath(new URL("../src/components/ketcher/context-menus.tsx", import.meta.url));
  const analogueModulePath = fileURLToPath(new URL("../src/components/ketcher/natural-analogue.tsx", import.meta.url));
  const periodicModulePath = fileURLToPath(new URL("../src/components/ketcher/periodic-table.tsx", import.meta.url));
  const moleculeModulePath = fileURLToPath(new URL("../src/components/ketcher/molecule-3d-preview.tsx", import.meta.url));
  const libraryModulePath = fileURLToPath(new URL("../src/components/ketcher/library-preview.tsx", import.meta.url));
  const annotationModulePath = fileURLToPath(new URL("../src/components/ketcher/annotation-controls.tsx", import.meta.url));
  const importModulePath = fileURLToPath(new URL("../src/components/ketcher/import-structures.tsx", import.meta.url));
  const importOptionsModulePath = fileURLToPath(new URL("../src/components/ketcher/import-options.tsx", import.meta.url));
  const chemicalInfoModulePath = fileURLToPath(new URL("../src/components/ketcher/chemical-info.tsx", import.meta.url));
  const tooltipModulePath = fileURLToPath(new URL("../src/components/ketcher/tool-tooltip.tsx", import.meta.url));
  const transform = (code: string, id: string) => {
      const normalizedId = id.replaceAll("\\", "/");
      if (/\/ketcher-react\/dist\/index\.css(?:$|\?)/u.test(normalizedId)) return { code: recolorKetcherCss(code), map: null };
      if (/\/ketcher-core\/dist\/application\/editor\/Editor(?:\.modern)?\.js$/u.test(normalizedId)) return { code: scopeKetcherKeyboard(code), map: null };
      const macro = /\/ketcher-react\/dist\/index\.modern-[a-f0-9]+\.js$/u.test(normalizedId);
      if (!macro && !normalizedId.endsWith("/ketcher-react/dist/index.js")) return null;
      if (macro) code = markSelectedRnaBuilderSlots(adaptMacroTitles(code, tooltipModulePath));
      if (!macro) {
        code = guardInitialCanvasWheel(code);
        code = adaptChemicalSurfaces(code);
        code = adaptAnnotationControls(code);
        code = adaptStructureLibrary(code);
        code = skipDisabledMacromoleculesEditor(code);
        const materialImports = [
          ["Accordion$2", "Accordion", "KetcherMaterialAccordion", "ce52c66c9e2d1055a028b81b4fe7108762ce0ad4912593a4c523ce0b05ff16ee"],
          ["AccordionSummary", "AccordionSummary", "KetcherMaterialAccordionSummary", "8be2a62c37fcc03d48a1704fef879087376a7699d7d300b8268ae04f2f2e67f7"],
          ["AccordionDetails", "AccordionDetails", "KetcherMaterialAccordionDetails", "2124908e15e52d49de336f10cd64ff45cb46f21da1cc464894c291a6f9dc305d"],
          ["Tab", "Tab", "KetcherMaterialTab", "954fe12d3b3a1372d48bbe9c30547c473d1a2db5da0d740a6f81f504f5c8af55"],
          ["Tabs$1", "Tabs", "KetcherMaterialTabs", "71cc536b92f9e26c26a9d9ac314718a39573cad93105fbb31df7edc7c6bab05e"],
        ];
        for (const [alias, name, adapter, hash] of materialImports) {
          const original = `import ${alias} from '@mui/material/${name}';`;
          if (code.indexOf(original) < 0 || code.indexOf(original) !== code.lastIndexOf(original)
            || createHash("sha256").update(original).digest("hex") !== hash) {
            throw new Error(`Ketcher material presentation contract changed: ${name}.`);
          }
          code = code.replace(original, `import { ${adapter} as ${alias} } from ${JSON.stringify(menuModulePath)};`);
        }
      }
      const contextImport = macro
        ? "import { Menu as Menu$1, useContextMenu, Submenu, Item, Separator, contextMenu } from 'react-contexify';"
        : "import { Submenu, Item, Separator, Menu, contextMenu, useContextMenu } from 'react-contexify';";
      if (!code.includes(contextImport) || code.indexOf(contextImport) !== code.lastIndexOf(contextImport)) {
        throw new Error("Ketcher context menu import contract changed.");
      }
      code = code.replace(contextImport, contextImport.replace("'react-contexify'", JSON.stringify(contextModulePath)));
      const bindings: Record<string, readonly [string, string, string?]> = macro ? macroPrimitives : primitives;
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const replacements: Array<{ start: number; end: number; text: string }> = [];
      const found = new Set<string>();
      for (const statement of source.statements) {
        const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
        for (const declaration of declarations) {
          if (!ts.isVariableDeclaration(declaration) && !ts.isFunctionDeclaration(declaration)) continue;
          const name = declaration.name?.getText(source);
          if (!name || !Object.hasOwn(bindings, name)) continue;
          const spec = bindings[name as keyof typeof bindings];
          const [component, expectedHash] = spec;
          const node = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration.body;
          if (!node || createHash("sha256").update(node.getText(source)).digest("hex") !== expectedHash || found.has(name)) {
            throw new Error(`Ketcher UI contract changed: ${name}. Review the upstream component before updating its adapter.`);
          }
          found.add(name);
          let replacement: string | undefined;
          if (spec[2] === "atoms") {
            replacement = node.getText(source).replace("jsx(StyledAtom,", "jsx(__buretteKetcherAtomButton,");
          } else if (spec[2] === "molecule-3d") {
            if (!ts.isFunctionExpression(node)) throw new Error("Ketcher 3D render changed.");
            const rendered = node.body.statements.findLast(ts.isReturnStatement);
            if (!rendered) throw new Error("Ketcher 3D render is missing.");
            replacement = node.getText(source).slice(0, rendered.getStart(source) - node.getStart(source))
              .replace("service.getStringFromStructureAsync(struct).then(", "return service.getStringFromStructureAsync(struct).then(")
              .replace("miew.setOptions(miewOpts);", "miew.setOptions(__buretteMolecule3dOptions(miewOpts));")
              .replace("KetcherLogger.error('Miew.tsx::MiewDialog::onMiewInit', e);", "KetcherLogger.error('Miew.tsx::MiewDialog::onMiewInit', e); throw e;")
              + "return jsx(__buretteMolecule3dPreview, { Viewer, onInit: onMiewInit, onApply: exportCML, disabled: isDisabled, initialized: isInitialized, options: miewOpts, params: prop });\n}";
          } else if (spec[2] === "micro-tools") {
            if (!ts.isFunctionExpression(node)) throw new Error("Ketcher molecule tool menu render changed.");
            const rendered = node.body.statements.findLast(ts.isReturnStatement);
            if (!rendered) throw new Error("Ketcher molecule tool menu render is missing.");
            // Keep tool/status selection and Redux actions, replacing only the
            // floating strip with an anchored, labelled, keyboard-accessible menu.
            replacement = node.getText(source).slice(0, rendered.getStart(source) - node.getStart(source)) + `
  return displayMultiToolItem && iconName ? jsx(__buretteKetcherMicroToolMenu, {
    rootRef: ref, rootClassName: classes$N.root, rootTestId: id + '-drop-down-button', open: isOpen,
    onOpenChange: function(next) { if (next) onOpenOptions(); else onOpen(id, true); },
    disabled: isDisabled, label: configWithNonViewOnlyActionsDisabled[currentId]?.title || 'Tools',
    primary: jsx(ActionButton, { className, name: iconName,
      action: configWithNonViewOnlyActionsDisabled[currentId], status: currentStatus,
      selected, disableableButtons, indigoVerification, onAction,
      dataTestId: dataTestId != null ? dataTestId : iconName }),
    groups: variant === 'grouped' ? groups : undefined,
    options: options.map(function(option) {
      var action = configWithNonViewOnlyActionsDisabled[option.id];
      var iconName = getIconName(option.id);
      var state = status[option.id] || {};
      return { id: option.id, label: action?.title || option.id,
        shortcut: shortcutStr(action?.shortcut), icon: iconName ? jsx(Icon, { name: iconName }) : null,
        hidden: state.hidden || !iconName,
        disabled: state.disabled || indigoVerification && disableableButtons.includes(iconName),
        active: !!state.selected,
        onSelect: function() { if (action?.action) onAction(action.action); } };
    })
  }) : null;
}`;
          } else if (spec.length === 3 && spec[2] !== "element" && ts.isFunctionExpression(node)) {
            const rendered = node.body.statements.findLast(ts.isReturnStatement);
            if (!rendered) throw new Error(`Ketcher render boundary is missing: ${name}.`);
            let props = macro
              ? "currentZoom, open: isExpanded, onOpen: onExpand, onClose, onZoomIn, onZoomOut, onZoomReset, align: 'end', shortcuts: { 'zoom-out': hotkeysShortcuts['zoom-minus'], 'zoom-in': hotkeysShortcuts['zoom-plus'], zoom: hotkeysShortcuts['zoom-reset'] }, input: jsx(ZoomInput, { onZoomSubmit, inputRef, currentZoom })"
              : "currentZoom, open: isExpanded, onOpen: onExpand, onClose, onZoomIn, onZoomOut, onZoomReset: resetZoom, shortcuts, hiddenButtons, disabledButtons, input: jsx(ZoomInput, { onZoomSubmit, inputRef, currentZoom, shortcuts })";
            if (spec[2] === "mode") props = "open: isExpanded, onOpen: onExpand, onClose, onSwitch: handleModeSwitch, disabled, isPolymerEditor, buttonRef: btnRef, icon: jsx(Icon, { name: modeIcon })";
            if (spec[2] === "copy") props = "topElement, dropDownElements, open: isExpanded, onOpen: expand, onClose: collapse";
            if (spec[2] === "tools") props = "open, onOpenChange: setOpen, disabled, rootRef: ref, rootTestId: testId, testId: 'multi-tool-dropdown', primary: jsx(MenuItem, { disabled, itemId: visibleItemId, title: visibleItemTitle, testId: visibleItemTestId, onClick: needOpenByMenuItemClick ? handleDropDownClick : EmptyFunction }), children: subComponents";
            if (spec[2] === "tool-item") props = "title, disabled, testId, onClick: onClickCallback, active: isActiveItem, className: itemId + activeClass, text: type !== 'icon-button', icon: type === 'icon-button' ? jsx(Icon, { name: itemId }) : title";
            if (spec[2] === "analogue") props = "value, onChange, options, disabled, className, error";
            replacement = node.getText(source).slice(0, rendered.getStart(source) - node.getStart(source)) +
              `return jsx(__burette${component}, { ${props} });\n}`;
          }
          if (name === "ActionButton") {
            replacement = node.getText(source).replace(/(jsx|jsxs)\("button"/gu, "$1(__buretteKetcherToolButton")
              .replace(/    title: .*\n/u, "    label: action?.title, shortcut, \"aria-pressed\": selected,\n")
              .replace(/, jsx\("kbd", \{\s*children: shortcut\s*\}\)/u, "");
          }
          if (name === "TextButton") {
            replacement = node.getText(source).replace('jsx("button", {', 'jsx(__buretteKetcherToolButton, { "aria-pressed": props.active,');
          }
          if (name === "ButtonGenSet") {
            replacement = node.getText(source).replace('jsx("button", {', 'jsx(__buretteKetcherChemicalButton, { "aria-pressed": selected(button.label),');
          }
          replacements.push({
            start: node.getStart(source), end: node.end,
            text: replacement ?? (spec.length === 3
              ? node.getText(source).replace(/(jsx|jsxs)\("button"/gu, `$1(__burette${component}`)
              : ts.isVariableDeclaration(declaration)
              ? `__burette${component}`
              : `{ return jsx(__burette${component}, arguments[0]); }`),
          });
        }
      }
      if (found.size !== Object.keys(bindings).length) throw new Error("Ketcher UI primitives are missing; expected ketcher-react 3.18.0.");
      for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        code = code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end);
      }
      const menuNames = new Set(["KetcherZoomMenu", "KetcherModeMenu", "KetcherCopyMenu", "KetcherMacroToolMenu", "KetcherMacroMenuItem", "KetcherMicroToolMenu"]);
      const menuImports = Array.from(new Set(Object.values(bindings).map(([name]) => name).filter((name) => menuNames.has(name)))).map((name) => `${name} as __burette${name}`).join(", ");
      const imports = Array.from(new Set(Object.values(bindings).map(([name]) => name).filter((name) => !menuNames.has(name) && name !== "KetcherNaturalAnaloguePicker" && name !== "Molecule3dPreview" && name !== "KetcherPeriodicElementButton" && name !== "KetcherElementChoice"))).map((name) => `${name} as __burette${name}`).join(", ");
      const analogueImport = macro ? "" : `import { KetcherNaturalAnaloguePicker as __buretteKetcherNaturalAnaloguePicker } from ${JSON.stringify(analogueModulePath)};\n`;
      const moleculeImport = macro ? "" : `import { Molecule3dPreview as __buretteMolecule3dPreview, molecule3dOptions as __buretteMolecule3dOptions } from ${JSON.stringify(moleculeModulePath)};\n`;
      const periodicImport = macro ? "" : `import { KetcherPeriodicElementButton as __buretteKetcherPeriodicElementButton, KetcherElementChoice as __buretteKetcherElementChoice } from ${JSON.stringify(periodicModulePath)};\n`;
      const libraryImport = macro ? "" : `import { KetcherLibraryPreview as __buretteKetcherLibraryPreview } from ${JSON.stringify(libraryModulePath)};\n`;
      const annotationImport = macro ? "" : `import { KetcherFontMenu as __buretteKetcherFontMenu, KetcherSymbolsMenu as __buretteKetcherSymbolsMenu, KetcherSymbolItems as __buretteKetcherSymbolItems, KetcherColorPicker as __buretteKetcherColorPicker, KetcherFieldLabel as __buretteKetcherFieldLabel } from ${JSON.stringify(annotationModulePath)};\n`;
      const chemicalImport = macro ? "" : `import { KetcherImportStructures as __buretteKetcherImportStructures, KetcherImportActions as __buretteKetcherImportActions } from ${JSON.stringify(importModulePath)};\nimport { KetcherImportOptions as __buretteKetcherImportOptions, KetcherImportDropzone as __buretteKetcherImportDropzone } from ${JSON.stringify(importOptionsModulePath)};\nimport { KetcherChemicalInfoSurface as __buretteKetcherChemicalInfoSurface } from ${JSON.stringify(chemicalInfoModulePath)};\n`;
      return { code: `import { ${imports} } from ${JSON.stringify(modulePath)};\nimport { ${menuImports} } from ${JSON.stringify(menuModulePath)};\n${analogueImport}${moleculeImport}${periodicImport}${libraryImport}${annotationImport}${chemicalImport}${code}`, map: null };
  };
  let base = "/";
  return {
    name: "burette-ketcher-ui",
    enforce: "pre",
    transform,
    configResolved: (config) => { base = config.base; },
    // The editor page imports Ketcher dynamically. Announce those chunks in its HTML so they
    // download while the entry script is still loading, and so a host can prefetch them.
    transformIndexHtml: {
      order: "post",
      handler: (html, context) => {
        const { bundle, chunk } = context;
        if (!bundle || !chunk || !context.filename.endsWith("ketcher.html")) return html;
        const files = new Set<string>();
        const styles = new Set<string>();
        const visit = (name: string) => {
          const item = bundle[name];
          if (!item || item.type !== "chunk" || files.has(name)) return;
          files.add(name);
          item.viteMetadata?.importedCss.forEach((css) => styles.add(css));
          item.imports.forEach(visit);
        };
        for (const name of chunk.dynamicImports) {
          const item = bundle[name];
          if (item?.type === "chunk" && /\/node_modules\/ketcher-(react|core|standalone)\//u.test(item.facadeModuleId ?? "")) visit(name);
        }
        const tags: HtmlTagDescriptor[] = [
          ...[...files].filter((file) => !html.includes(file)).map((file) => ({ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: base + file }, injectTo: "head" as const })),
          ...[...styles].filter((file) => !html.includes(file)).map((file) => ({ tag: "link", attrs: { rel: "preload", as: "style", crossorigin: true, href: base + file }, injectTo: "head" as const })),
        ];
        return { html, tags };
      },
    },
    config: () => ({
      // Both SettingsService and Ketcher use named EventEmitter imports in 3.18.
      // The explicit browser package must win over the Node built-in in both builds.
      resolve: { alias: { events: createRequire(import.meta.url).resolve("events/") } },
      optimizeDeps: { rolldownOptions: { plugins: [{ name: `burette-ketcher-ui-${createHash("sha256").update(JSON.stringify([primitives, macroPrimitives, annotationContracts, chemicalSurfaceContracts, macroTitleContracts, "library-preview-3.18.0", "rna-builder-selected", "macro-tooltip", "scoped-keyboard-with-canvas-focus"])).digest("hex").slice(0, 12)}`, transform, resolveId: (id: string) => [modulePath, menuModulePath, contextModulePath, analogueModulePath, periodicModulePath, moleculeModulePath, libraryModulePath, annotationModulePath, importModulePath, importOptionsModulePath, chemicalInfoModulePath, tooltipModulePath].includes(id) ? { id: `/@fs/${id}`, external: true } : null }] } },
    }),
  };
}
