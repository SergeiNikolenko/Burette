import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, Toaster } from "@/components/ui/toast";

export function ToastExamples() {
  const [opened, setOpened] = useState(false);
  return <>
    <Button variant="secondary" onClick={() => toast.add({ title: "Changes saved", type: "success" })}>Save notice</Button>
    <Button variant="secondary" onClick={() => toast.add({ title: "Connection lost", description: "Reconnect to the remote computer to continue.", type: "error", priority: "high", timeout: 0, actionProps: { children: "Reconnect", onClick: () => setOpened(true) } })}>Connection notice</Button>
    {opened && <output role="status">Connection settings opened</output>}
    <Toaster />
  </>;
}
