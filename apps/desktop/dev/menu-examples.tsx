import { useState } from "react";
import { Button } from "@/components/ui/button";
import * as Menu from "@/components/ui/dropdown-menu";
import * as Context from "@/components/ui/context-menu";

export function MenuExamples() {
  const [labels, setLabels] = useState(true);
  const [color, setColor] = useState("element");
  const [result, setResult] = useState("");
  return <>
    <Menu.DropdownMenu>
      <Menu.DropdownMenuTrigger asChild><Button variant="secondary">View options</Button></Menu.DropdownMenuTrigger>
      <Menu.DropdownMenuContent>
        <Menu.DropdownMenuCheckboxItem checked={labels} onCheckedChange={setLabels} onSelect={e => e.preventDefault()}>Atom labels</Menu.DropdownMenuCheckboxItem>
        <Menu.DropdownMenuCheckboxItem disabled>Hydrogen bonds</Menu.DropdownMenuCheckboxItem>
        <Menu.DropdownMenuSeparator />
        <Menu.DropdownMenuLabel>Color by</Menu.DropdownMenuLabel>
        <Menu.DropdownMenuRadioGroup value={color} onValueChange={setColor}>
          <Menu.DropdownMenuRadioItem value="element">Element</Menu.DropdownMenuRadioItem>
          <Menu.DropdownMenuRadioItem value="chain">Chain</Menu.DropdownMenuRadioItem>
        </Menu.DropdownMenuRadioGroup>
        <Menu.DropdownMenuSeparator />
        <Menu.DropdownMenuSub>
          <Menu.DropdownMenuSubTrigger>Representation</Menu.DropdownMenuSubTrigger>
          <Menu.DropdownMenuPortal><Menu.DropdownMenuSubContent>
            <Menu.DropdownMenuItem onSelect={() => setResult("Ball and stick selected")}>Ball and stick</Menu.DropdownMenuItem>
            <Menu.DropdownMenuItem onSelect={() => setResult("Cartoon selected")}>Cartoon</Menu.DropdownMenuItem>
          </Menu.DropdownMenuSubContent></Menu.DropdownMenuPortal>
        </Menu.DropdownMenuSub>
      </Menu.DropdownMenuContent>
    </Menu.DropdownMenu>
    <Context.ContextMenu>
      <Context.ContextMenuTrigger asChild><Button variant="secondary">Structure options</Button></Context.ContextMenuTrigger>
      <Context.ContextMenuContent>
        <Context.ContextMenuItem onSelect={() => setResult("Structure selected")}>Select structure</Context.ContextMenuItem>
        <Context.ContextMenuSub><Context.ContextMenuSubTrigger>Labels</Context.ContextMenuSubTrigger>
          <Context.ContextMenuPortal><Context.ContextMenuSubContent>
            <Context.ContextMenuCheckboxItem checked={labels} onCheckedChange={setLabels}>Atom labels</Context.ContextMenuCheckboxItem>
          </Context.ContextMenuSubContent></Context.ContextMenuPortal>
        </Context.ContextMenuSub>
      </Context.ContextMenuContent>
    </Context.ContextMenu>
    {result && <output>{result}</output>}
  </>;
}
