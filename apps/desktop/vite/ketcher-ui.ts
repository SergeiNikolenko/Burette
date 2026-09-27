import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler-api";
import type { Plugin } from "vite";

// Ketcher 3.18 publishes one bundle and has no component-slot API. Replace only
// its shared presentation primitives; retain the original form codecs, Redux
// actions, chemistry services, and canvas. Hash each boundary so an upstream
// update cannot silently bind a different component to the old prop contract.
const primitives = {
  ToolbarMultiToolItem: ["KetcherToolExpand", "65d6919047397da37f95bdb681554beae7872aedc973ab62dd6ef2a7e9d66345", "micro-tools"],
  NaturalAnaloguePicker: ["KetcherNaturalAnaloguePicker", "a4b525c9433ab0a132b538959f8909415704c07b9e7a7f2967f948a73a487266", "analogue"],
  ModeControl: ["KetcherModeMenu", "0595ccc27d93ef843dedcd37b832887671463c2f84512e808c8fb021187e863d", "mode"],
  MenuItemWithDropdown: ["KetcherCopyMenu", "c01a0a837d6a9863f32b867db05cb6b60f1fbc91158406794430ad456bc90206", "copy"],
  StyledInput: ["KetcherInput", "713dbc0d1379c92a6da292030f8864d8a110ec2136857e3432b9da377f15bd03"],
  ZoomControls: ["KetcherZoomMenu", "ead5dcc2dace52301377a46d27581e0659c15e0305d4a7d8876fff4481ae9485", "zoom"],
  ActionButton: ["KetcherToolButton", "0bf094cdb48eba39761058ed55e8d6dc010079152d737e1c74584d7f312da1b8", "element"],
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
} as const;

const macroPrimitives = {
  SubMenu: ["KetcherMacroToolMenu", "205a773456918414949090541c7223b78a2477603202cf255f8fd7c3ae6651d5", "tools"],
  MenuItem: ["KetcherMacroMenuItem", "0d153d1201f708a98fe624c537ad49d4a232049d92283bfaa04c9c606867fdd6", "tool-item"],
  StyledInput: ["KetcherInput", "a41ff625ace21d9407a1231af73bacc96ed6f4ef10b4cabeba2b09018ff17f31"],
  ZoomControls: ["KetcherZoomMenu", "3de482e34c4d475cde51f8f02ff6ebbd8c5218cbd3f0a0da88c51b78106dc0db", "zoom"],
} as const;

export function ketcherUiPlugin(): Plugin {
  const modulePath = fileURLToPath(new URL("../src/components/ketcher/primitives.tsx", import.meta.url));
  const menuModulePath = fileURLToPath(new URL("../src/components/ketcher/menus.tsx", import.meta.url));
  const contextModulePath = fileURLToPath(new URL("../src/components/ketcher/context-menus.tsx", import.meta.url));
  const analogueModulePath = fileURLToPath(new URL("../src/components/ketcher/natural-analogue.tsx", import.meta.url));
  const transform = (code: string, id: string) => {
      const normalizedId = id.replaceAll("\\", "/");
      const macro = normalizedId.endsWith("/ketcher-react/dist/index.modern-55d8e3ef.js");
      if (!macro && !normalizedId.endsWith("/ketcher-react/dist/index.js")) return null;
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
          if (spec[2] === "micro-tools") {
            // Separate choosing the current tool from opening its alternatives.
            replacement = node.getText(source)
              .replace("className: className,\n      name: iconName,", "className: className,\n      onAction: onAction,\n      name: iconName,")
              .replace(/!isOpen && !isDisabled && jsx\(Icon, \{[\s\S]*?onClick: onOpenOptions\n    \}\)/u,
                "jsx(__buretteKetcherToolExpand, { onClick: onOpenOptions, disabled: isDisabled, expanded: isOpen })");
          } else if (spec.length === 3 && spec[2] !== "element" && ts.isFunctionExpression(node)) {
            const rendered = [...node.body.statements].reverse().find(ts.isReturnStatement);
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
      const menuNames = new Set(["KetcherZoomMenu", "KetcherModeMenu", "KetcherCopyMenu", "KetcherMacroToolMenu", "KetcherMacroMenuItem"]);
      const menuImports = Array.from(new Set(Object.values(bindings).map(([name]) => name).filter((name) => menuNames.has(name)))).map((name) => `${name} as __burette${name}`).join(", ");
      const imports = Array.from(new Set(Object.values(bindings).map(([name]) => name).filter((name) => !menuNames.has(name) && name !== "KetcherNaturalAnaloguePicker"))).map((name) => `${name} as __burette${name}`).join(", ");
      const analogueImport = macro ? "" : `import { KetcherNaturalAnaloguePicker as __buretteKetcherNaturalAnaloguePicker } from ${JSON.stringify(analogueModulePath)};\n`;
      return { code: `import { ${imports} } from ${JSON.stringify(modulePath)};\nimport { ${menuImports} } from ${JSON.stringify(menuModulePath)};\n${analogueImport}${code}`, map: null };
  };
  return {
    name: "burette-ketcher-ui",
    enforce: "pre",
    transform,
    config: () => ({
      // Ketcher 3.18's SettingsService imports Node's events by name. Resolve
      // the browser implementation in both the optimizer and production build.
      resolve: { alias: { events: createRequire(import.meta.url).resolve("events/") } },
      optimizeDeps: { rolldownOptions: { plugins: [{ name: `burette-ketcher-ui-${createHash("sha256").update(JSON.stringify([primitives, macroPrimitives])).digest("hex").slice(0, 12)}`, transform, resolveId: (id: string) => [modulePath, menuModulePath, contextModulePath, analogueModulePath].includes(id) ? { id: `/@fs/${id}`, external: true } : null }] } },
    }),
  };
}
