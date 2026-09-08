import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import "./text-panel.css";

type Props = {
  purpose: "import" | "export";
  format: string;
  formatLabel: string;
  formats: { value: string; label: string }[];
  value: string;
  status: string;
  ready: boolean;
  busy: boolean;
  applyEdits: boolean;
  onModeChange: (purpose: "import" | "export") => void;
  onFormatChange: (format: string) => void;
  onValueChange: (value: string) => void;
  onLoad: () => void;
  onCopy: () => void;
  onSave: () => void;
  onOpenRaw: () => void;
};

export function KetcherTextPanel(props: Props) {
  const exporting = props.purpose === "export";
  return (
    <section className="ketcher-dock-workflow ketcher-text-panel" aria-label="Structure text">
      <Tabs value={props.purpose} onValueChange={(value) => props.onModeChange(value as Props["purpose"])}>
        <TabsList aria-label="Structure text mode" className="w-full">
          <TabsTrigger value="import" disabled={!props.ready}>Import</TabsTrigger>
          <TabsTrigger value="export" disabled={!props.ready}>Export</TabsTrigger>
        </TabsList>
        <TabsContent value={props.purpose} className="ketcher-text-content">
          <Select value={props.format} onValueChange={props.onFormatChange}>
            <SelectTrigger size="sm" aria-label="Structure format" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {props.formats.map((format) => <SelectItem key={format.value} value={format.value}>{format.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea
            className="ketcher-text-input"
            aria-label={`${exporting ? "Export" : "Import"} ${props.formatLabel}`}
            placeholder="Paste SMILES, MOL, SDF, or a reaction…"
            readOnly={exporting}
            spellCheck={false}
            value={props.value}
            onChange={(event) => props.onValueChange(event.target.value)}
          />
          <span className="ketcher-text-status" role="status">{props.status}</span>
          <div className="ketcher-text-actions">
            {exporting ? <>
              <Button variant="outline" size="sm" disabled={!props.value} onClick={props.onCopy}>Copy</Button>
              <Button variant="outline" size="sm" disabled={!props.value} onClick={props.onSave}>Save</Button>
              <Button variant="secondary" size="sm" disabled={!props.value} onClick={props.onOpenRaw}>Open raw</Button>
            </> : <Button size="sm" disabled={!props.ready || props.busy || (!props.applyEdits && !props.value.trim())} onClick={props.onLoad}>{props.applyEdits ? "Apply" : "Load"}</Button>}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
