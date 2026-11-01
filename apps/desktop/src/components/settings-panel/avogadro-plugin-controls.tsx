import { useState } from "react";
import type { AvogadroPlugin } from "../../lib/extensions/avogadro-plugin-index";
import type { InstalledAvogadroPlugin } from "../../lib/extensions/avogadro-plugin-runner";
import { readPluginManifest } from "../../lib/extensions/avogadro-plugin-manifest";
import type { ResourceJob } from "../../lib/extensions/resource-install-runner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import type { PluginRowParts } from "./avogadro-plugins-section";

export type PluginControlsProps = {
  plugin: AvogadroPlugin;
  installed?: InstalledAvogadroPlugin;
  /** The newest job for this plugin. */
  job?: ResourceJob;
  install: (plugin: AvogadroPlugin) => void;
  remove: (name: string) => void;
  cancel: (jobId: string) => void;
  dismiss: (jobId: string) => void;
};

function InstallDialog({ plugin, update, open, onOpenChange, onConfirm }: { plugin: AvogadroPlugin; update: boolean; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{`${update ? "Update" : "Install"} ${plugin.name} ${plugin.version}?`}</AlertDialogTitle>
        <AlertDialogDescription>Burette downloads the package and checks it against the Avogadro plugin index. Its code runs only after you set it up.</AlertDialogDescription>
      </AlertDialogHeader>
      <dl className="avogadro-plugins-details avogadro-plugins-dialog-details">
        <dt>License</dt><dd>{plugin.license}</dd>
        <dt>Authors</dt><dd>{plugin.authors.join(", ")}</dd>
        <dt>Source</dt><dd className="break-all">{plugin.repository.replace(/^https:\/\//u, "")}</dd>
        <dt>Revision</dt><dd className="font-mono">{plugin.commit.slice(0, 12)}</dd>
      </dl>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>{update ? "Update" : "Install"}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

/** Desktop install state and actions for one catalog row. */
export function pluginRowParts(props: PluginControlsProps): PluginRowParts {
  const { plugin, job, install, remove, dismiss } = props;
  const failed = job?.status === "failed" ? job : undefined;
  return {
    actions: <PluginActions {...props} />,
    alert: failed && <>
      <span role="alert" className="min-w-0 flex-1 break-words text-sm">{failed.error}</span>
      <Button variant="outline" size="settings" onClick={() => failed.operation === "remove" ? remove(plugin.name) : install(plugin)}>Retry</Button>
      <Button variant="ghost" size="settings" onClick={() => dismiss(failed.id)}>Dismiss</Button>
    </>,
    details: props.installed && <PluginDetails plugin={plugin} installed={props.installed} />,
  };
}

function PluginActions({ plugin, installed, job, install, remove, cancel }: PluginControlsProps) {
  const [dialog, setDialog] = useState<"install" | "remove" | null>(null);
  const busy = job && (job.status === "queued" || job.status === "running") ? job : undefined;
  const current = installed?.commit === plugin.commit;
  const status = busy ? (!busy.cancelable && busy.operation !== "remove" ? "Cancelling…" : busy.operation === "remove" ? "Removing…" : busy.operation === "update" ? "Updating…" : "Installing…")
    : installed ? (current ? "Installed" : `${installed.version} installed`) : null;
  return <>
    {status && <span role="status" className="text-sm whitespace-nowrap">{status}</span>}
    {busy ? busy.operation !== "remove" && <Button variant="outline" size="settings" disabled={!busy.cancelable}
      aria-label={`Cancel ${plugin.name} ${busy.operation === "update" ? "update" : "installation"}`} onClick={() => cancel(busy.id)}>Cancel</Button>
      : <>
        {(!installed || !current) && <Button variant="outline" size="settings" aria-label={`${installed ? "Update" : "Install"} ${plugin.name}`}
          onClick={() => setDialog("install")}>{installed ? "Update" : "Install"}</Button>}
        {installed && <Button variant="ghost" size="settings" aria-label={`Remove ${plugin.name}`} onClick={() => setDialog("remove")}>Remove</Button>}
      </>}
    <InstallDialog plugin={plugin} update={Boolean(installed)} open={dialog === "install"} onOpenChange={open => setDialog(open ? "install" : null)}
      onConfirm={() => install(plugin)} />
    <AlertDialog open={dialog === "remove"} onOpenChange={open => setDialog(open ? "remove" : null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Remove ${plugin.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>The package and its prepared environment are deleted. Documents you opened or exported stay.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => remove(plugin.name)}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function PluginDetails({ plugin, installed }: { plugin: AvogadroPlugin; installed: InstalledAvogadroPlugin }) {
  const [license, setLicense] = useState(false);
  const manifest = readPluginManifest(installed.pyproject);
  return <>
    <dt>Installed</dt><dd>{`${installed.version} · ${installed.commit.slice(0, 12)}`}</dd>
    {manifest && manifest.commands.length > 0 && <><dt>Commands</dt><dd>{manifest.commands.map(command => [...command.menuPath.filter(part => part !== "Extensions"), command.label].join(" › ")).join(", ")}</dd></>}
    {installed.licenseText && <><dt className="sr-only">License text</dt><dd className="avogadro-plugins-links">
      <Button variant="link" size="settings" onClick={() => setLicense(true)}>View license</Button>
      <Dialog open={license} onOpenChange={setLicense}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`${plugin.name} license`}</DialogTitle>
            <DialogDescription>{installed.version}</DialogDescription>
          </DialogHeader>
          <pre className="avogadro-plugins-license">{installed.licenseText}</pre>
        </DialogContent>
      </Dialog>
    </dd></>}
  </>;
}
