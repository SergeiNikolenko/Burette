import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin } from "vite";

// Ketcher 3.15 publishes one bundle and has no component-slot API. Replace only
// its shared presentation primitives; retain the original form codecs, Redux
// actions, chemistry services, and canvas. Hash each boundary so an upstream
// update cannot silently bind a different component to the old prop contract.
const primitives = {
  ToolbarMultiToolItem: ["KetcherToolExpand", "46bd57bb10389d41fe5a870e1a4e1d4a69022197888f27169f64bb4c723c0e42", "micro-tools"],
  NaturalAnaloguePicker: ["KetcherNaturalAnaloguePicker", "a4b525c9433ab0a132b538959f8909415704c07b9e7a7f2967f948a73a487266", "analogue"],
  ModeControl: ["KetcherModeMenu", "9a9c8ab3bb6c6188be66ef24d603a194d4e3c2aa86fe7b04401dfffd90bd840f", "mode"],
  MenuItemWithDropdown: ["KetcherCopyMenu", "e974e38c6b473257dedbd3c29823eac292990664952f23001f8f372c23b37134", "copy"],
  StyledInput: ["KetcherInput", "713dbc0d1379c92a6da292030f8864d8a110ec2136857e3432b9da377f15bd03"],
  ZoomControls: ["KetcherZoomMenu", "c9e6024d44b93351b64894d7c3da9e4658019ec604a597b1c85cf56e1c8d9b01", "zoom"],
  ActionButton: ["KetcherToolButton", "2dc63d5a60a38101b83b2df5be604913f3454c9c2a4d852e6b9656cea3fce619", "element"],
  Atom: ["KetcherToolButton", "9088afa95821aa168dbbdb8cd164a532ae4e5a3bd980256025adcb97b7b7beb1", "element"],
  IconButtonBase: ["KetcherIconButton", "144231e80ffa149a5b2c9018262b0c03b3107a4124f2aab63e5b2abd1d445881"],
  Button: ["KetcherButton", "4ba70e36710083309f326cce3514c2e1f25ab46abbfc97f2abd49ce2c4ecf9d9"],
  "Input$2": ["KetcherInput", "d250e7dc2092c637e421af76e4000c322f6f52622e97172d4c91524374dca03a"],
  "Accordion$1": ["KetcherAccordion", "c79c2a51649129de971bdacb0619287ecbebb9aa003332a92a29099e7951c197"],
  Accordion: ["KetcherSettingsAccordion", "12cdc477f741295ccdab572a2ca5bc2fbc6d7c74b4a86fa60856014853c1a6fe"],
  Dialog: ["KetcherDialog", "e60cd78bb6e0e200e1cd90d6bd7a89eaf11b212f2c6162f01d634d4672ec0c4d"],
  "Select$1": ["KetcherSelect", "d845d63b8e037f7571d1a811c9f83c412e00eb0cca1fbf4323c9dac5245a95b4"],
  GenericInput: ["KetcherGenericInput", "b3196b29ae1b16ad2fd3da561129df6e7fb7938a3fefb1c01656a9365572d3ba"],
  TextArea: ["KetcherTextarea", "6268697300dde96a049dd5cc8806c4a8eda829affd5354ad2efc0d06ad197479"],
  CheckBox: ["KetcherCheckbox", "141c9a93c6efce0af604ef71e801e55bef8d7f152d76432abd73df8b83487b5e"],
  Slider: ["KetcherSwitch", "32c4ebed08a1f0fcfef9e474fd8345067e542255918d5592e4741b0778fb78ab"],
} as const;

const macroPrimitives = {
  SubMenu: ["KetcherMacroToolMenu", "05bb9a1557a0bc1506f069c6e6d5ba768d4eca1bce3c209e48f2c5bcb8de6d26", "tools"],
  MenuItem: ["KetcherMacroMenuItem", "0d153d1201f708a98fe624c537ad49d4a232049d92283bfaa04c9c606867fdd6", "tool-item"],
  StyledInput: ["KetcherInput", "46e4ad6c63c8285915e8a8ec600ee1b7862e5b86de23ff15efcda47c6b673feb"],
  ZoomControls: ["KetcherZoomMenu", "65a70e7d55dc5c4b1cd9464674a9ff844f1d56485658aa21d22a8b78106ae9d2", "zoom"],
} as const;

export function ketcherUiPlugin(): Plugin {
  const modulePath = fileURLToPath(new URL("../src/components/ketcher/primitives.tsx", import.meta.url));
  const menuModulePath = fileURLToPath(new URL("../src/components/ketcher/menus.tsx", import.meta.url));
  const contextModulePath = fileURLToPath(new URL("../src/components/ketcher/context-menus.tsx", import.meta.url));
  const analogueModulePath = fileURLToPath(new URL("../src/components/ketcher/natural-analogue.tsx", import.meta.url));
  const transform = (code: string, id: string) => {
      const normalizedId = id.replaceAll("\\", "/");
      const macro = normalizedId.endsWith("/ketcher-react/dist/index.modern-7545f4b2.js");
      if (!macro && !normalizedId.endsWith("/ketcher-react/dist/index.js")) return null;
      const contextImport = macro
        ? "import { Menu as Menu$1, useContextMenu, Submenu, Item, Separator } from 'react-contexify';"
        : "import { Submenu, Item, Separator, Menu, useContextMenu } from 'react-contexify';";
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
      if (found.size !== Object.keys(bindings).length) throw new Error("Ketcher UI primitives are missing; expected ketcher-react 3.15.0.");
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
    config: () => ({ optimizeDeps: { rolldownOptions: { plugins: [{ name: `burette-ketcher-ui-${createHash("sha256").update(JSON.stringify([primitives, macroPrimitives])).digest("hex").slice(0, 12)}`, transform, resolveId: (id: string) => [modulePath, menuModulePath, contextModulePath, analogueModulePath].includes(id) ? { id: `/@fs/${id}`, external: true } : null }] } } }),
  };
}
