import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "DOMRect", "HTMLInputElement", "Node", "NodeFilter", "CustomEvent", "Event", "KeyboardEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } = await import("../apps/desktop/src/components/ui/dialog");
const { Button } = await import("../apps/desktop/src/components/ui/button");
const { Popover, PopoverTrigger, PopoverContent } = await import("../apps/desktop/src/components/ui/popover");
const { Input } = await import("../apps/desktop/src/components/ui/input");

// Let Radix finish the scheduled focus restoration, not a CSS-animation delay.
const flushFocus = () => new Promise(resolve => setTimeout(resolve, 0));
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
