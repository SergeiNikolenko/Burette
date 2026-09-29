import { useEffect, useState, type FormEvent } from "react";

import { Agent, ArrowRight, Atom, Edit, Flask, Search } from "@/components/ui/app-icons";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import type {
  NativeWorkspaceHome as HomeBridge,
  NativeWorkspaceRecentFile,
  NativeWorkspaceStructureLink,
} from "@/lib/native-mcp-workspace";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import type { ShellActions } from "../types";

const PDB_ID = /^[0-9][a-z0-9]{3}$/iu;

// Every starter opens through the same app links as Codex deep links.
const starters = [
  { title: "Alcohol dehydrogenase", detail: "1HTB · protein with NAD and a ligand", link: "/example/1htb", icon: Atom },
  { title: "Hemoglobin", detail: "4HHB · from the Protein Data Bank", link: "/pdb/4HHB", icon: Atom },
  { title: "Caffeine", detail: "Small molecule drawn by xyzrender", link: "/example/caffeine", icon: Flask },
] as const;

const prompts = [
  "Open the molecular files in this project in Burette",
  "Find the ligand pocket of 1HTB and select the residues around it",
  "Draw aspirin in Ketcher and show its 3D conformer",
];

type Notice = { tone: "info" | "error"; text: string } | null;

// The start page of the Codex sidebar app and thread tab. It replaces the
// desktop welcome screen, whose file picker has no path-based equivalent here.
export function NativeWorkspaceHome({ actions, home }: { actions: ShellActions; home: HomeBridge }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NativeWorkspaceStructureLink[] | null>(null);
  const [recent, setRecent] = useState<NativeWorkspaceRecentFile[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let current = true;
    // Recent files are a convenience: without them the page still works.
    home.recent().then(files => { if (current) setRecent(files); }, () => undefined);
    return () => { current = false; };
  }, [home]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setResults(null);
      setSearching(false);
      return undefined;
    }
    let current = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      home.search(text)
        .then(items => { if (current) setResults(items); })
        .catch(error => { if (current) setNotice({ tone: "error", text: `PDB search failed: ${message(error)}` }); })
        .finally(() => { if (current) setSearching(false); });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [home, query]);

  const run = async (key: string, task: () => Promise<void>, done?: string) => {
    setPending(key);
    setNotice(null);
    try {
      await task();
      if (done) setNotice({ tone: "info", text: done });
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
    } finally {
      setPending(null);
    }
  };
  const open = (link: string, label: string) => run(link, () => home.open(link), `Opening ${label}…`);
  const ask = (text: string) => run(text, () => home.ask(text), "Sent to Codex.");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    const target = PDB_ID.test(text) ? text.toUpperCase() : results?.[0]?.name;
    if (target) void open(`/pdb/${target}`, target);
    else if (text) setNotice({ tone: "error", text: "Enter a four-character PDB ID or search by name." });
  };

  return (
    <div className="native-workspace-home flex h-full w-full justify-center overflow-y-auto px-6 py-12">
      <div className="flex w-full max-w-[680px] flex-col gap-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
            <Atom className="size-5" />
          </span>
          <h1 className="text-2xl font-medium tracking-tight text-foreground">What would you like to look at?</h1>
          <p className="text-sm text-muted-foreground">Pick up a recent file, search the Protein Data Bank, or ask Codex.</p>
        </header>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <InputGroup className="h-11 rounded-full bg-background px-1 shadow-xs">
            <InputGroupAddon>
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search the Protein Data Bank"
              placeholder="PDB ID or keywords, e.g. 4HHB or kinase inhibitor"
              value={query}
              maxLength={200}
              onChange={event => setQuery(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              {searching ? <Spinner className="text-muted-foreground" /> : null}
              <InputGroupButton type="submit" variant="default" size="sm" className="rounded-full" disabled={pending !== null || !query.trim()}>
                Open
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {/* A fixed-height line: a notice appearing must not move the rows below under the pointer. */}
          <p role="status" className={`min-h-5 truncate px-4 text-sm ${notice?.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {notice?.text}
          </p>
          {results ? (
            <ItemGroup className="gap-1 rounded-2xl border border-border bg-background p-1.5" aria-label="PDB entries">
              {results.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No PDB entries match “{query.trim()}”.</p> : null}
              {results.map(item => (
                <Item key={item.name} asChild size="xs" className="rounded-xl hover:bg-muted">
                  <button type="button" disabled={pending !== null} onClick={() => void open(`/pdb/${item.name}`, item.name)}>
                    <ItemContent className="min-w-0 text-left">
                      <ItemTitle className="font-mono">{item.name}</ItemTitle>
                      <ItemDescription className="truncate">{structureTitle(item)}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {pending === `/pdb/${item.name}` ? <Spinner /> : <ArrowRight className="size-4 text-muted-foreground" />}
                    </ItemActions>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          ) : null}
        </form>

        {recent.length ? (
          <section className="flex flex-col gap-3" aria-labelledby="native-home-recent">
            <h2 id="native-home-recent" className="px-1 text-sm font-medium text-muted-foreground">Recent</h2>
            <ItemGroup className="gap-0.5 rounded-2xl border border-border bg-background p-1.5">
              {recent.map(file => {
                const link = `/open?path=${encodeURIComponent(file.path)}`;
                return (
                  <Item key={file.path} asChild size="xs" className="rounded-xl hover:bg-muted">
                    <button type="button" disabled={pending !== null} onClick={() => void open(link, file.label)} title={file.path}>
                      <ItemMedia className="text-muted-foreground [&_svg]:size-4">
                        {pending === link ? <Spinner /> : <FileKindIcon kind={fileKindForPath(file.path, file.format)} />}
                      </ItemMedia>
                      <ItemContent className="min-w-0 flex-row items-baseline gap-2 text-left group-data-[size=xs]/item:gap-2">
                        <ItemTitle className="shrink-0">{file.label}</ItemTitle>
                        <ItemDescription className="truncate">{folderOf(file.path)}</ItemDescription>
                      </ItemContent>
                      <ItemActions className="text-xs text-muted-foreground tabular-nums">{openedAgo(file.openedAt)}</ItemActions>
                    </button>
                  </Item>
                );
              })}
            </ItemGroup>
          </section>
        ) : null}

        <section className="flex flex-col gap-3" aria-labelledby="native-home-start">
          <h2 id="native-home-start" className="px-1 text-sm font-medium text-muted-foreground">Start with</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {starters.map(starter => (
              <Item key={starter.link} asChild variant="outline" className="rounded-2xl bg-background hover:bg-muted">
                <button type="button" disabled={pending !== null} onClick={() => void open(starter.link, starter.title)}>
                  <ItemMedia className="flex size-9 items-center justify-center rounded-xl bg-muted">
                    {pending === starter.link ? <Spinner /> : <starter.icon className="size-4" />}
                  </ItemMedia>
                  <ItemContent className="min-w-0 text-left">
                    <ItemTitle>{starter.title}</ItemTitle>
                    <ItemDescription className="truncate">{starter.detail}</ItemDescription>
                  </ItemContent>
                </button>
              </Item>
            ))}
            <Item asChild variant="outline" className="rounded-2xl bg-background hover:bg-muted">
              <button type="button" onClick={() => actions.openKetcher()}>
                <ItemMedia className="flex size-9 items-center justify-center rounded-xl bg-muted">
                  <Edit className="size-4" />
                </ItemMedia>
                <ItemContent className="min-w-0 text-left">
                  <ItemTitle>Draw a molecule</ItemTitle>
                  <ItemDescription className="truncate">Sketch in Ketcher</ItemDescription>
                </ItemContent>
              </button>
            </Item>
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="native-home-ask">
          <h2 id="native-home-ask" className="px-1 text-sm font-medium text-muted-foreground">Ask Codex</h2>
          <ItemGroup className="gap-1">
            {prompts.map(prompt => (
              <Item key={prompt} asChild size="sm" className="rounded-xl hover:bg-muted">
                <button type="button" disabled={pending !== null} onClick={() => void ask(prompt)}>
                  <ItemMedia>
                    {pending === prompt ? <Spinner /> : <Agent className="size-4 text-muted-foreground" />}
                  </ItemMedia>
                  <ItemContent className="text-left">
                    <ItemTitle className="font-normal">{prompt}</ItemTitle>
                  </ItemContent>
                </button>
              </Item>
            ))}
          </ItemGroup>
        </section>
      </div>
    </div>
  );
}

function structureTitle(item: NativeWorkspaceStructureLink) {
  const title = item.title?.startsWith(`${item.name} · `) ? item.title.slice(item.name.length + 3) : item.title;
  if (!title) return "PDB entry";
  // Older PDB entries carry upper-case titles.
  return title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase() : title;
}

// Downloaded PDB entries and bundled examples live in cache folders whose
// names mean nothing to the user.
function folderOf(path: string) {
  const folders = path.split("/").slice(1, -1);
  if (folders[folders.length - 1] === "burette-pdb-entries") return "Protein Data Bank";
  if (folders.slice(-3).join("/") === "burette-agent/assets/examples") return "Burette examples";
  return folders.slice(-2).join("/");
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

function openedAgo(openedAt: string) {
  const minutes = Math.round((Date.parse(openedAt) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? relativeTime.format(hours, "hour") : relativeTime.format(Math.round(hours / 24), "day");
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
