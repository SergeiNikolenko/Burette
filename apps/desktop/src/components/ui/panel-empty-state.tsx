import type { ReactNode } from "react";
import { Button } from "./button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";

// Atlas EmptyState: plain 32px glyph, 16/24 title, 12px gaps and a 24px action.
export function PanelEmptyState({ title, icon, description, action }: {
  title: string;
  icon: ReactNode;
  description?: string;
  action?: { label: string; run: () => void };
}) {
  return <Empty className="gap-3 rounded-none p-6">
    <EmptyMedia className="mb-0 text-(--color-text-secondary) [&_svg]:size-8" aria-hidden>{icon}</EmptyMedia>
    <EmptyHeader className="w-full max-w-72 gap-2">
      <EmptyTitle className="text-lg leading-6 font-medium tracking-normal text-(--color-text)">{title}</EmptyTitle>
      {description && <EmptyDescription className="text-sm text-(--color-text-secondary)">{description}</EmptyDescription>}
    </EmptyHeader>
    {action && <Button type="button" size="xs" onClick={action.run}>{action.label}</Button>}
  </Empty>;
}
