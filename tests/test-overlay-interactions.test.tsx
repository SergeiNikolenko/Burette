import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["DocumentFragment", "HTMLFormElement", "HTMLSelectElement", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "DOMRect", "HTMLInputElement", "Node", "NodeFilter", "CustomEvent", "Event", "KeyboardEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } = await import("../apps/desktop/src/components/ui/dialog");
const { Button } = await import("../apps/desktop/src/components/ui/button");
const { Popover, PopoverTrigger, PopoverContent } = await import("../apps/desktop/src/components/ui/popover");
const { Input } = await import("../apps/desktop/src/components/ui/input");
const { Command, CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } = await import("../apps/desktop/src/components/ui/command");

test("command dialog labels, filtering and keyboard selection survive its Atlas surface", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  const selected: string[] = [];
  function Example() {
    const [open, setOpen] = React.useState(true);
    return <CommandDialog open={open} onOpenChange={setOpen} title="Commands" description="Find a command">
      <Command><CommandInput variant="plain" aria-label="Search commands" /><CommandList>
        <CommandEmpty>No results</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem value="open" onSelect={value => selected.push(value)}>Open file</CommandItem>
          <CommandItem value="unavailable" disabled>Unavailable</CommandItem>
          <CommandItem value="settings" onSelect={value => { selected.push(value); setOpen(false); }}>Settings</CommandItem>
        </CommandGroup>
      </CommandList></Command>
    </CommandDialog>;
  }
  try {
    await act(async () => root.render(<Example />));
    const dialog = shell.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector(`#${dialog.getAttribute("aria-labelledby")}`)?.textContent).toBe("Commands");
    const input = dialog.querySelector<HTMLInputElement>('[cmdk-input]')!;
    expect(document.activeElement).toBe(input);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(input, "not-found"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(dialog.querySelector('[cmdk-empty]')?.textContent).toBe("No results");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(selected).toEqual([]);
    await act(async () => { setValue.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(dialog.querySelector('[cmdk-item][data-selected="true"]')?.textContent).toContain("Settings");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(selected).toEqual(["settings"]);
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

// Let Radix finish the scheduled focus restoration, not a CSS-animation delay.
const flushFocus = () => new Promise(resolve => setTimeout(resolve, 0));

test("programmatic modal forms restore the current opener after Escape and Cancel", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  function Example() {
    const [open, setOpen] = React.useState(false);
    return <>
      <Button onClick={() => setOpen(true)}>Rename file</Button>
      <Button onClick={() => setOpen(true)}>Rename folder</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="form" aria-describedby={undefined}>
          <DialogTitle>Rename</DialogTitle><Input aria-label="Name" />
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </DialogContent>
      </Dialog>
    </>;
  }
  try {
    await act(async () => root.render(<Example />));
    const openers = [...shell.querySelectorAll<HTMLButtonElement>("button")];
    for (const [index, opener] of openers.entries()) {
      await act(async () => { opener.focus(); opener.click(); });
      expect(document.activeElement).toBe(shell.querySelector("input"));
      await act(async () => {
        if (index === 0) document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else [...shell.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Cancel")!.click();
      });
      await act(flushFocus);
      expect(shell.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("dialog return focus respects explicit destinations and non-modal outside focus", async () => {
  for (const modal of [true, false]) {
    const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
    const root = createRoot(shell);
    const destination = React.createRef<HTMLButtonElement>();
    function Example() {
      const [open, setOpen] = React.useState(false);
      return <>
        <Button onClick={() => setOpen(true)}>Open</Button><Button ref={destination}>Next action</Button>
        <Dialog modal={modal} open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined} onCloseAutoFocus={modal ? event => {
            event.preventDefault(); destination.current!.focus();
          } : undefined}>
            <DialogTitle>Edit</DialogTitle><Input aria-label="Value" />
          </DialogContent>
        </Dialog>
      </>;
    }
    try {
      await act(async () => root.render(<Example />));
      const opener = shell.querySelector<HTMLButtonElement>("button")!;
      await act(async () => { opener.focus(); opener.click(); });
      await act(async () => {
        if (modal) document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else destination.current!.focus();
      });
      await act(flushFocus);
      expect(shell.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(destination.current);
    } finally { await act(async () => root.unmount()); shell.remove(); }
  }
});

test("dialog action buttons preserve submit, disabled and slotted close behavior", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  let submissions = 0;
  const ref = React.createRef<HTMLButtonElement>();
  function Example() {
    const [ready, setReady] = React.useState(false);
    return <Dialog><DialogTrigger>Rename</DialogTrigger><DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Rename series</DialogTitle></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); submissions++; }}>
        <Button onClick={() => setReady(true)}>Enable save</Button>
        <DialogFooter showCloseButton><Button ref={ref} type="submit" disabled={!ready}>Save</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>;
  }
  try {
    await act(async () => root.render(<Example />));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')!;
    await act(async () => trigger.click());
    expect(ref.current?.disabled).toBe(true);
    await act(async () => ref.current!.click());
    expect(submissions).toBe(0);
    const enable = [...shell.querySelectorAll("button")].find(el => el.textContent === "Enable save")!;
    await act(async () => enable.click());
    expect(submissions).toBe(0);
    expect(ref.current?.disabled).toBe(false);
    await act(async () => ref.current!.click());
    expect(submissions).toBe(1);
    const close = [...shell.querySelectorAll("button")].find(el => el.textContent === "Close")!;
    await act(async () => close.click()); await act(flushFocus);
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
    expect(submissions).toBe(1);
    expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("nested popover inherits the shell and Escape unwinds one overlay at a time", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<Dialog><DialogTrigger>Rename</DialogTrigger><DialogContent variant="form" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Rename series</DialogTitle></DialogHeader><Input aria-label="Name" defaultValue="Series" />
      <Popover><PopoverTrigger>Options</PopoverTrigger><PopoverContent aria-label="Options"><Input aria-label="Prefix" /></PopoverContent></Popover>
    </DialogContent></Dialog>));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')!;
    await act(async () => trigger.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
    const options = shell.querySelector<HTMLButtonElement>('[data-slot="popover-trigger"]')!;
    await act(async () => options.click());
    expect(shell.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Prefix");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await flushFocus(); });
    expect(shell.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(shell.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(document.activeElement === options).toBe(true);
    await act(async () => { options.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await flushFocus(); });
    expect(shell.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("explicit popover containers stay authoritative over the shell default", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell";
  const portal = document.createElement("div"); document.body.append(shell, portal);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<Popover defaultOpen><PopoverTrigger>Open</PopoverTrigger><PopoverContent container={portal} aria-label="Options"><Input aria-label="Label" /></PopoverContent></Popover>));
    expect(portal.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    expect(shell.querySelector('[data-slot="popover-content"]')).toBeNull();
  } finally { await act(async () => root.unmount()); shell.remove(); portal.remove(); }
});

const { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } = await import("../apps/desktop/src/components/ui/alert-dialog");
test("confirmation focuses Cancel and only the explicit action commits", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  let commits = 0;
  try {
    await act(async () => root.render(<AlertDialog><AlertDialogTrigger>Reset display</AlertDialogTrigger><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Reset display settings?</AlertDialogTitle><AlertDialogDescription>Restore the default appearance.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => commits++}>Reset settings</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-trigger"]')!;
    const open = async () => { await act(async () => trigger.click()); await act(flushFocus); };
    const click = async (slot: string) => { await act(async () => shell.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!.click()); await act(flushFocus); };
    await open();
    expect(document.activeElement?.textContent).toBe("Cancel");
    const dialog = shell.querySelector('[role="alertdialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Restore the default appearance.");
    await act(async () => {
      document.body.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }) as unknown as Event);
      document.body.click();
    });
    expect(shell.querySelector('[role="alertdialog"]') !== null).toBe(true);
    expect(commits).toBe(0);
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(flushFocus);
    expect(shell.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
    expect(commits).toBe(0);
    await open(); await click("alert-dialog-cancel");
    expect(commits).toBe(0);
    expect(document.activeElement === trigger).toBe(true);
    await open(); await click("alert-dialog-action");
    expect(commits).toBe(1);
    expect(shell.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

const { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } = await import("../apps/desktop/src/components/ui/tooltip");
const { NativeSelect, NativeSelectOption } = await import("../apps/desktop/src/components/ui/native-select");

test("toolbar buttons retain tooltip focus, disabled actions and non-submit defaults", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  const zoom = React.createRef<HTMLButtonElement>();
  let changes = 0; let submissions = 0;
  try {
    await act(async () => root.render(<form onSubmit={event => { event.preventDefault(); submissions++; }}>
      <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild>
        <Button ref={zoom} variant="ghost" size="icon-toolbar" aria-label="Zoom in" onClick={() => changes++}><span aria-hidden>+</span></Button>
      </TooltipTrigger><TooltipContent>Increase scale</TooltipContent></Tooltip></TooltipProvider>
      <Button variant="ghost" size="toolbar" disabled onClick={() => changes--}>Zoom out</Button>
    </form>));
    await act(async () => zoom.current!.focus());
    expect(shell.querySelector('[role="tooltip"]')?.textContent).toBe("Increase scale");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Zoom in");
    await act(async () => { zoom.current!.click(); shell.querySelector<HTMLButtonElement>("button[disabled]")!.click(); });
    expect({ changes, submissions }).toEqual({ changes: 1, submissions: 0 });
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("a select's portaled options do not reopen the parent tooltip on focus or pointer movement", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  const changes: string[] = [];
  try {
    await act(async () => root.render(<TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><div>
      <NativeSelect aria-label="Operation" defaultValue="optimize" onChange={event => changes.push(event.target.value)}>
        <NativeSelectOption value="optimize">Optimize</NativeSelectOption>
        <NativeSelectOption value="properties">Properties</NativeSelectOption>
      </NativeSelect>
    </div></TooltipTrigger><TooltipContent>Relax atomic coordinates</TooltipContent></Tooltip></TooltipProvider>));
    const trigger = shell.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(async () => trigger.focus());
    expect(shell.querySelector('[role="tooltip"]')?.textContent).toBe("Relax atomic coordinates");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(flushFocus);
    const options = [...shell.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map(option => option.textContent)).toEqual(["Optimize", "Properties"]);
    expect(document.activeElement).toBe(options[0]);
    expect(shell.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => options[1].dispatchEvent(new browser.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }) as unknown as Event));
    await act(flushFocus);
    expect(document.activeElement).toBe(options[1]);
    expect(shell.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => options[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(flushFocus);
    expect(changes).toEqual(["properties"]);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.textContent).toBe("Properties");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(shell.querySelector('[role="tooltip"]')).toBeNull();
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("tooltip opens on keyboard focus without moving it and Escape removes its description", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<TooltipProvider><Tooltip><TooltipTrigger>Fit</TooltipTrigger><TooltipContent compact>Fit structure</TooltipContent></Tooltip></TooltipProvider>));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="tooltip-trigger"]')!;
    await act(async () => trigger.focus());
    const description = document.getElementById(trigger.getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe("Fit structure");
    expect(shell.contains(description)).toBe(true);
    expect(document.activeElement === trigger).toBe(true);
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(shell.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("tooltip waits on first pointer entry and respects an explicit themed portal", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell";
  const portal = document.createElement("div"); document.body.append(shell, portal);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<TooltipProvider><Tooltip><TooltipTrigger>Inspect</TooltipTrigger><TooltipContent container={portal}>Inspect properties</TooltipContent></Tooltip></TooltipProvider>));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="tooltip-trigger"]')!;
    await act(async () => { trigger.dispatchEvent(new browser.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }) as unknown as Event); });
    expect(portal.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    expect(portal.querySelector('[data-slot="tooltip-content"]') !== null).toBe(true);
    expect(shell.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(false);
    await act(async () => trigger.click());
    expect(portal.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  } finally { await act(async () => root.unmount()); shell.remove(); portal.remove(); }
});

const Menu = await import("../apps/desktop/src/components/ui/dropdown-menu");
const Context = await import("../apps/desktop/src/components/ui/context-menu");
const { RadixDropdownMenu, showRadixContextMenu } = await import("../apps/desktop/src/components/radix-menu");
const { SelectControl } = await import("../apps/desktop/src/components/settings-panel/setting-control");

for (const context of [false, true]) {
  test(`application ${context ? "context" : "dropdown"} submenu escapes the parent's overflow and selects once`, async () => {
    const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
    const root = createRoot(shell);
    let selected = 0;
    const items = [{ kind: "submenu" as const, id: "open", text: "Open", items: [
      { kind: "item" as const, id: "tabs", text: "In Tabs", action: () => selected++ },
    ] }];
    const prefix = context ? "context" : "dropdown";
    try {
      if (context) {
        await act(async () => showRadixContextMenu(items, { x: 20, y: 20 }));
      } else {
        await act(async () => root.render(<RadixDropdownMenu items={items} trigger={<button>Open options</button>} />));
        await act(async () => shell.querySelector('button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
      }
      await act(flushFocus);
      const trigger = shell.querySelector<HTMLElement>(`[data-slot="${prefix}-menu-sub-trigger"]`)!;
      await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
      await act(flushFocus);
      const content = shell.querySelector(`[data-slot="${prefix}-menu-sub-content"]`)!;
      expect(content !== null).toBe(true);
      expect(content.parentElement!.closest(`[data-slot="${prefix}-menu-content"]`)).toBeNull();
      await act(async () => content.querySelector<HTMLElement>('[role="menuitem"]')!.click()); await act(flushFocus);
      expect([selected, shell.querySelector('[role="menu"]')]).toEqual([1, null]);
    } finally { await act(async () => root.unmount()); shell.remove(); }
  });
}

for (const context of [false, true]) {
  test(`${context ? "context" : "dropdown"} checkbox keeps the menu open; closeOnSelect is explicit`, async () => {
    const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
    const root = createRoot(shell);
    const changes: boolean[] = [];
    const selections: boolean[] = [];
    const Root = context ? Context.ContextMenu : Menu.DropdownMenu;
    const Trigger = context ? Context.ContextMenuTrigger : Menu.DropdownMenuTrigger;
    const Content = context ? Context.ContextMenuContent : Menu.DropdownMenuContent;
    const Check = context ? Context.ContextMenuCheckboxItem : Menu.DropdownMenuCheckboxItem;
    function Example() {
      const [checked, setChecked] = React.useState(true);
      return <Root modal={false}><Trigger>View</Trigger><Content>
        <Check checked={checked} onCheckedChange={value => {
          changes.push(value === true); setChecked(value === true);
        }} onSelect={event => selections.push(event.defaultPrevented)}>Hydrogens</Check>
        <Check disabled onCheckedChange={() => { throw new Error("Disabled item selected"); }}>Unavailable</Check>
        <Check closeOnSelect onSelect={event => selections.push(event.defaultPrevented)}>Apply and close</Check>
      </Content></Root>;
    }
    try {
      await act(async () => root.render(<Example />));
      const trigger = shell.querySelector<HTMLElement>(`[data-slot="${context ? "context" : "dropdown"}-menu-trigger"]`)!;
      await act(async () => trigger.dispatchEvent(context
        ? new browser.MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }) as unknown as Event
        : new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
      await act(flushFocus);
      let checks = [...shell.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
      await act(async () => checks[0].click()); await act(flushFocus);
      checks = [...shell.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
      expect([changes, selections, checks[0].getAttribute("aria-checked")]).toEqual([[false], [true], "false"]);
      await act(async () => { checks[0].focus(); checks[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
      await act(flushFocus);
      expect(document.activeElement).toBe(checks[2]);
      await act(async () => checks[2].click()); await act(flushFocus);
      expect(selections).toEqual([true, false]);
      expect(shell.querySelector('[role="menu"]')).toBeNull();
    } finally { await act(async () => root.unmount()); shell.remove(); }
  });
}

test("settings select displays labels, commits raw values once and restores trigger focus", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  const changes: string[] = [];
  function Example() {
    const [value, setValue] = React.useState("gfnff");
    return <SelectControl label="Method" value={value} options={["gfnff", "gfn2"]}
      labels={{ gfnff: "Force field", gfn2: "Quantum" }} onChange={next => { changes.push(next); setValue(next); }} />;
  }
  try {
    await act(async () => root.render(<Example />));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!;
    expect(trigger.textContent).toBe("Force field");
    const open = async () => {
      await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
      await act(flushFocus);
    };
    await open();
    const items = [...shell.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.map(item => [item.textContent, item.getAttribute("aria-checked")])).toEqual([["Force field", "true"], ["Quantum", "false"]]);
    await act(async () => items[1].click()); await act(flushFocus);
    expect(changes).toEqual(["gfn2"]);
    expect(trigger.textContent).toBe("Quantum");
    expect(shell.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await open();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(flushFocus);
    expect(changes).toEqual(["gfn2"]);
    expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("dropdown and submenu inherit the shell; selection closes both and restores focus", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  let selected = 0;
  try {
    await act(async () => root.render(<Menu.DropdownMenu><Menu.DropdownMenuTrigger>View options</Menu.DropdownMenuTrigger>
      <Menu.DropdownMenuContent><Menu.DropdownMenuSub><Menu.DropdownMenuSubTrigger>Representation</Menu.DropdownMenuSubTrigger>
        <Menu.DropdownMenuPortal><Menu.DropdownMenuSubContent><Menu.DropdownMenuItem onSelect={() => selected++}>Cartoon</Menu.DropdownMenuItem></Menu.DropdownMenuSubContent></Menu.DropdownMenuPortal>
      </Menu.DropdownMenuSub></Menu.DropdownMenuContent>
    </Menu.DropdownMenu>));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!;
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(flushFocus);
    expect(shell.querySelector('[data-slot="dropdown-menu-content"]') !== null).toBe(true);
    const sub = shell.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!;
    await act(async () => { sub.focus(); sub.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    await act(flushFocus);
    expect(shell.querySelector('[data-slot="dropdown-menu-sub-content"]') !== null).toBe(true);
    await act(async () => shell.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]')!.click());
    await act(flushFocus);
    expect(selected).toBe(1);
    expect(shell.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("context menu uses its explicit container and Escape does not select", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell";
  const portal = document.createElement("div"); document.body.append(shell, portal);
  const root = createRoot(shell);
  let selected = 0;
  try {
    await act(async () => root.render(<Context.ContextMenu><Context.ContextMenuTrigger>Structure</Context.ContextMenuTrigger>
      <Context.ContextMenuContent container={portal}><Context.ContextMenuItem onSelect={() => selected++}>Inspect</Context.ContextMenuItem></Context.ContextMenuContent>
    </Context.ContextMenu>));
    await act(async () => { shell.querySelector('[data-slot="context-menu-trigger"]')!.dispatchEvent(new browser.MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }) as unknown as Event); });
    expect(portal.querySelector('[role="menu"]') !== null).toBe(true);
    expect(shell.querySelector('[role="menu"]')).toBeNull();
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(flushFocus);
    expect(portal.querySelector('[role="menu"]')).toBeNull();
    expect(selected).toBe(0);
  } finally { await act(async () => root.unmount()); shell.remove(); portal.remove(); }
});
