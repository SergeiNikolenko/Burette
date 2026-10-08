import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, Toaster } from "@/components/ui/toast";

export function ToastExamples() {
  const [opened, setOpened] = useState<string | null>(null);
  return <>
    <Button variant="secondary" onClick={() => toast.add({ title: "Changes saved", type: "success" })}>Save notice</Button>
    <Button variant="secondary" onClick={() => toast.add({ title: "Export ready", type: "info", timeout: 0, actionPlacement: "inline", actionProps: { children: "Open", onClick: () => setOpened("Export opened") } })}>Export notice</Button>
    <Button variant="secondary" onClick={() => toast.add({ title: "Connection lost", description: "Reconnect to the remote computer to continue.", type: "error", priority: "high", timeout: 0, actionProps: { children: "Reconnect", onClick: () => setOpened("Connection settings opened") } })}>Connection notice</Button>
    {opened && <output role="status">{opened}</output>}
    <Toaster />
  </>;
}
