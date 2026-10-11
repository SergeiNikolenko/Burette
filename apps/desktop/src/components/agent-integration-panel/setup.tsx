import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { writeClipboardText } from "../../lib/clipboard";
import { SettingsSection } from "../settings-panel/setting-control";

type Setup = { title: string; instructions: string; value: string; copyLabel: string };

export function AgentSetup({ bundlePath }: { bundlePath: string | null }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Use single-quote shell escaping: app names may contain spaces, quotes or $.
  const installer = bundlePath && `node '${`${bundlePath}/scripts/install-local.mjs`.replaceAll("'", "'\\''")}'`;
  const show = (next: Setup) => { setCopyState("idle"); setSetup(next); };
  const copy = async () => {
    if (!setup) return;
    try { await writeClipboardText(setup.value); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };

  return <>
    <SettingsSection title="Set up" rows={[
      {
        label: "Codex plugin",
        control: <Button variant="secondary" size="toolbar" disabled={!installer} onClick={() => installer && show({
          title: "Install in Codex",
          instructions: "Run this command in Terminal with Node.js installed, then restart Codex. It installs Burette’s bundled plugin with molecular tools and an embedded workspace.",
          value: installer,
          copyLabel: "Copy command",
        })}>Install command</Button>,
      },
      {
        label: "Local MCP client",
        control: <Button variant="secondary" size="toolbar" disabled={!bundlePath} onClick={() => bundlePath && show({
          title: "Connect local tools",
          instructions: "Add this server to your client’s MCP configuration, then restart the client. Requires Node.js. Embedded workspaces depend on client support; this does not install the Codex plugin.",
          value: JSON.stringify({ mcpServers: { burette_agent_mcp: {
            command: "node", args: [`${bundlePath}/mcp/lib/server-bundle.mjs`, "--stdio"], cwd: bundlePath,
          } } }, null, 2),
          copyLabel: "Copy configuration",
        })}>MCP configuration</Button>,
      },
      {
        label: "ChatGPT",
        control: <Button variant="secondary" size="toolbar" onClick={() => show({
          title: "Connect in ChatGPT",
          instructions: "In ChatGPT’s app settings, create a connection using this MCP server URL. This connects the hosted workspace for attachments and public PDB structures; it cannot access files on your Mac.",
          value: "https://burette-plugin.vercel.app/mcp",
          copyLabel: "Copy URL",
        })}>Server URL</Button>,
      },
    ]} />
    {!bundlePath && <p className="mb-4 text-sm">Open the installed Burette app with a working plugin bundle to connect local tools.</p>}
    <Dialog open={setup !== null} onOpenChange={open => { if (!open) setSetup(null); }}>
      {setup && <DialogContent>
        <DialogHeader>
          <DialogTitle>{setup.title}</DialogTitle>
          <DialogDescription>{setup.instructions}</DialogDescription>
        </DialogHeader>
        <Textarea aria-label={setup.copyLabel.replace("Copy ", "")} readOnly value={setup.value} className="max-h-64 font-mono text-xs" spellCheck={false} />
        {copyState === "failed" && <p role="alert" className="text-sm text-(--color-text-danger)">Could not copy. Select and copy the text above.</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setSetup(null)}>Done</Button>
          <Button onClick={() => void copy()}><span aria-live="polite">{copyState === "copied" ? "Copied" : setup.copyLabel}</span></Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
}
