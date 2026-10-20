import { useState } from "react";
import { CalculatePropertiesDialog } from "@/components/calculate-properties-dialog";
import { Button } from "@/components/ui/button";

const request = { documentId: "properties-example", documentTitle: "Series" };
export function PropertiesExample() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("");
  return <section aria-label="Property selection">
    <Button variant="secondary" onClick={() => setOpen(true)}>Calculate properties</Button>
    {result && <output className="ml-3 text-sm">{result}</output>}
    <CalculatePropertiesDialog request={open ? request : null} onDismiss={() => setOpen(false)}
      onRun={(_id, properties, options) => setResult(`${properties.length} properties${options.mordred ? " + extended descriptors" : ""}`)} />
  </section>;
}
