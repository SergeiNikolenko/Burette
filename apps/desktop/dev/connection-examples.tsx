import { useState } from "react";
import { SshConnectionsList } from "@/components/ssh/ssh-connections-list";
import type { SshConnection } from "@/lib/ssh-projects";

// Exercise the production list without SSH requests or persisted connections.
export function ConnectionExamples() {
  const [connections, setConnections] = useState<SshConnection[]>([
    { host: "build-box", name: "build-box", enabled: false },
    { host: "research-box", name: "Research", enabled: true },
  ]);
  return <div className="w-full max-w-[600px]">
    <h2 className="mb-6 text-[24px] leading-8 text-(--color-text)">Connections</h2>
    <SshConnectionsList connections={connections}
      onAdd={() => setConnections(items => [...items, { host: `machine-${items.length + 1}`, name: `Machine ${items.length + 1}`, enabled: true }])}
      onEnabledChange={(connection, enabled) => setConnections(items => items.map(item => item.host === connection.host ? { ...item, enabled } : item))}
      onCheck={async host => { if (host === "research-box") throw new Error("Unavailable fixture"); }}
      onRemove={host => setConnections(items => items.filter(item => item.host !== host))}
      onAddFolder={host => setConnections(items => items.map(item => item.host === host ? { ...item, name: "Structures" } : item))} />
  </div>;
}
