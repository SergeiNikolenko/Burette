type ChemicalSpaceGroupLegendProps = {
  /** Sizes of the coloured groups, biggest first; index i wears colors[i]. */
  sizes: number[];
  colors: readonly string[];
  /** CSS colour of ungrouped points, which differs between the 2D and 3D renderers. */
  neutralColor: string;
  /** Molecules drawn in the neutral colour: smaller groups and singletons. */
  otherCount: number;
  cutoff: number;
  onSelectGroup: (rank: number) => void;
};

// The map only has ten colours for groups, so the legend says which ten and
// what the grey means. Without it "369 groups" on the button and ten coloured
// blobs on the map read as a contradiction.
export function ChemicalSpaceGroupLegend({
  sizes,
  colors,
  neutralColor,
  otherCount,
  cutoff,
  onSelectGroup,
}: ChemicalSpaceGroupLegendProps) {
  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-3 flex w-48 flex-col gap-1 rounded-lg border border-border bg-background/85 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur"
      data-testid="chemical-space-group-legend"
    >
      <div className="font-medium text-foreground">
        Groups <span className="font-normal text-muted-foreground">· similarity ≥ {cutoff.toFixed(2)}</span>
      </div>
      <div className="text-muted-foreground">Molecules per group. Click one to select it.</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {sizes.map((size, rank) => (
          <button
            key={rank}
            type="button"
            className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left tabular-nums hover:bg-accent"
            title={`Select the ${size} molecules of group ${rank + 1} in Grid`}
            onClick={() => onSelectGroup(rank)}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: colors[rank] }} />
            <span className="text-foreground">{size}</span>
          </button>
        ))}
      </div>
      {otherCount > 0 ? (
        <div className="flex items-center gap-1.5 px-1 text-muted-foreground">
          <span className="size-2 shrink-0 rounded-full" style={{ background: neutralColor }} />
          <span>{otherCount} in smaller groups or alone</span>
        </div>
      ) : null}
    </div>
  );
}
