import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import type { WhatsNewEntry } from "./whats-new";

const longDateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

// One release from config/whats-new.json, laid out like the Codex changelog
// dialog: date and version badge, title, summary, then the note sections.
export function ReleaseNotesDialog({ entry, onClose }: { entry: WhatsNewEntry | null; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {entry ? (
        <DialogContent className="max-h-[min(720px,calc(100dvh-2rem))] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <article className="px-7 pt-7 pb-8 select-text">
            <div className="flex items-center gap-2 pe-10 text-sm font-medium text-muted-foreground">
              <time dateTime={entry.date}>{longDateFormat.format(new Date(entry.date))}</time>
              <Badge variant="secondary" className="font-mono tabular-nums">v{entry.version}</Badge>
            </div>
            <DialogTitle className="mt-2 text-2xl leading-8 font-semibold">{entry.title}</DialogTitle>
            <DialogDescription className="mt-2 max-w-prose text-base leading-6 text-muted-foreground">
              {entry.summary}
            </DialogDescription>
            {entry.sections.length > 0 ? (
              <div className="mt-7 border-t border-border pt-7">
                {entry.sections.map((section) => (
                  <section key={section.title} className="mt-7 first:mt-0">
                    <h3 className="mb-2 text-base leading-6 font-semibold">{section.title}</h3>
                    <ul className="m-0 list-disc space-y-2 ps-5 text-base leading-6 text-muted-foreground">
                      {section.items.map((item) => <li key={item} className="ps-0.5">{item}</li>)}
                    </ul>
                  </section>
                ))}
              </div>
            ) : null}
          </article>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
