import { Button } from "@/components/ui/button";
import { ChevronDown } from "@/components/ui/app-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ChemicalSpaceViewControls({ hasSelection, onFitAll, onFitSelection }: {
  hasSelection: boolean;
  onFitAll: () => void;
  onFitSelection: () => void;
}) {
  return (
    <div className="absolute left-2 top-2 z-10" aria-label="Map camera">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="bg-background/90">Fit <ChevronDown size={14} aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onFitAll}>Fit all</DropdownMenuItem>
          <DropdownMenuItem disabled={!hasSelection} onSelect={onFitSelection}>Fit selection</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
