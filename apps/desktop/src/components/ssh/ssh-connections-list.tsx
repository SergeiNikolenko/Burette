import { useRef, useState, type RefObject } from "react";
import type { SshConnection } from "../../lib/ssh-projects";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { DotsHorizontal, SidebarGlobe } from "../ui/app-icons";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Switch } from "../ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";

type ConnectionActions = {
  onEnabledChange: (connection: SshConnection, enabled: boolean) => void;
  onCheck: (host: string) => Promise<unknown>;
  onRemove: (host: string) => void;
  onAddFolder: (host: string) => void;
};

export function SshConnectionsList({ connections, onAdd, ...actions }: ConnectionActions & { connections: SshConnection[]; onAdd: () => void }) {
  const addButton = useRef<HTMLButtonElement>(null);
  return <section className="ssh-connections" aria-label="SSH connections">
    <div className="ssh-connections-header"><h2>SSH connections from this Mac</h2><Button ref={addButton} size="xs" onClick={onAdd}>Add</Button></div>
    {connections.length > 0 && <Card className="settings-card ssh-connections-card">
      {connections.map(connection => <ConnectionRow key={connection.host} connection={connection} returnFocus={addButton} {...actions} />)}
    </Card>}
  </section>;
}

function ConnectionRow({ connection, onCheck, onRemove, onEnabledChange, onAddFolder, returnFocus }: ConnectionActions & { connection: SshConnection; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "unavailable">("idle");
  const menuButton = useRef<HTMLButtonElement>(null);
  const [removing, setRemoving] = useState(false);
  const busy = status === "checking";
  async function check() {
    if (busy || !connection.enabled) return;
    setStatus("checking");
    try { await onCheck(connection.host); setStatus("available"); }
    catch { setStatus("unavailable"); }
  }
  const label = !connection.enabled ? "Disabled" : { idle: "Not checked", checking: "Connecting…", available: "Available", unavailable: "Unavailable" }[status];
  return <div role="group" aria-label={connection.name} className="ssh-connection-row">
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Switch size="sm" aria-label={`Enable ${connection.name}`} checked={connection.enabled} disabled={busy} onCheckedChange={enabled => { onEnabledChange(connection, enabled); setStatus("idle"); }} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium"><SidebarGlobe size={14} className="shrink-0" aria-hidden /><span className="truncate">{connection.name}</span></div>
        {connection.host !== connection.name && <div className="truncate text-xs text-muted-foreground" title={connection.host}>{connection.host}</div>}
        <div role="status" className="ssh-connection-status" data-status={connection.enabled ? status : "disabled"}><span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />{label}</div>
      </div>
    </div>
    <NativeDropdownMenu items={[
      { kind: "item", id: "check", text: "Check connection", disabled: busy || !connection.enabled, action: () => void check() },
      { kind: "item", id: "add-folder", text: "Add folder", disabled: busy || !connection.enabled, action: () => onAddFolder(connection.host) },
      { kind: "separator" },
      { kind: "item", id: "remove", text: "Remove connection", disabled: busy, action: () => setRemoving(true) },
    ]} trigger={<Button ref={menuButton} variant="ghost" size="icon-sm" aria-label={`Options for ${connection.name}`}><DotsHorizontal size={16} aria-hidden /></Button>} />
    <AlertDialog open={removing} onOpenChange={setRemoving}>
      <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); (menuButton.current ?? returnFocus.current)?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle className="wrap-anywhere">Remove {connection.name}?</AlertDialogTitle><AlertDialogDescription>This removes the connection and its saved projects from Burette. Remote files are kept.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => onRemove(connection.host)}>Remove</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
