import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { Spinner } from "./ui/spinner";

import { databaseProviderDescriptor } from "../lib/database";
import type { DatabaseQueryDraft } from "../hooks/use-app-database";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { ScrubNumberField } from "./ui/scrub-number-input";

/**
 * One dialog for every Database provider: which fields it shows is decided by the
 * provider's descriptor, so a new provider does not need a new dialog.
 */
export function DatabaseQueryDialog({
  query,
  onDismiss,
  onSubmit,
}: {
  query: DatabaseQueryDraft | null;
  onDismiss: () => void;
  onSubmit: (draft: DatabaseQueryDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<DatabaseQueryDraft | null>(query);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const generation = useRef(0);

  // The menu can reopen the dialog for another provider while it is on screen,
  // and each provider starts from its own defaults.
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setDraft(query); setBusy(false); setError("");
    return () => { generation.current += 1; };
  }, [query]);

  const descriptor = draft ? databaseProviderDescriptor(draft.provider) : null;
  const update = (patch: Partial<DatabaseQueryDraft>) => {
    setError("");
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  };
  const submitDisabled = Boolean(draft && descriptor && (
    (descriptor.needsStructure && !draft.structure.trim())
    || (descriptor.needsUrl && !draft.url.trim())
    || (descriptor.needsSql && (!draft.sqlConnection.trim() || !draft.sqlStatement.trim()))
  ));

  return (
    <Dialog open={query !== null} onOpenChange={open => { if (!open && !pending.current) onDismiss(); }}>
      <DialogContent variant="form" size="default" className="min-w-0 overscroll-contain" showCloseButton={!busy}
        onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }}
        onInteractOutside={event => { if (pending.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{descriptor?.title ?? "Database"}</DialogTitle>
          <DialogDescription className="sr-only">{descriptor?.description}</DialogDescription>
        </DialogHeader>
          {draft && descriptor ? (
            <form
              className="flex min-w-0 flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (submitDisabled || pending.current) return;
                const token = generation.current;
                pending.current = true; setBusy(true); setError("");
                void Promise.resolve().then(() => onSubmit(draft)).catch(() => {
                  if (generation.current === token) setError("Could not start this search. Try again.");
                }).finally(() => {
                  if (generation.current === token) { pending.current = false; setBusy(false); }
                });
              }}
            >
              <fieldset disabled={busy} className="flex max-h-[min(60dvh,520px)] min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain">
              {descriptor.delivery === "records" && <p className="text-xs text-(--color-text-secondary)">Matches are added to the open collection.</p>}
              {descriptor.needsStructure ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label className="text-xs font-normal" htmlFor="database-query-structure">Query structure (SMILES)</Label>
                  <Input variant="field"
                    id="database-query-structure" autoComplete="off" name="structure"
                    value={draft.structure}
                    spellCheck={false}
                    placeholder="CC(=O)Oc1ccccc1C(=O)O"
                    onChange={(event) => update({ structure: event.target.value })}
                  />
                </div>
              ) : null}
              {descriptor.supportsSearchMode ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label className="text-xs font-normal" htmlFor="database-query-mode">Search</Label>
                  <NativeSelect className="w-full"
                    id="database-query-mode" name="mode"
                    value={draft.searchMode}
                    onChange={(event) => update({ searchMode: event.target.value as DatabaseQueryDraft["searchMode"] })}
                  >
                    <option value="substructure">Substructure</option>
                    <option value="similarity">Similarity</option>
                    <option value="exact">Exact structure</option>
                  </NativeSelect>
                </div>
              ) : null}
              {draft.searchMode === "similarity" || !descriptor.supportsSearchMode ? (
                descriptor.needsStructure ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-threshold">Minimum similarity (%)</Label>
                    <ScrubNumberField disabled={busy}
                      id="database-query-threshold"
                      aria-label="Minimum similarity (%)"
                      className="w-full"
                      min={40}
                      max={100}
                      value={draft.similarityThreshold}
                      onValueChange={(similarityThreshold) => update({ similarityThreshold })}
                    />
                  </div>
                ) : null
              ) : null}
              {descriptor.needsApiKey ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label className="text-xs font-normal" htmlFor="database-query-api-key">ChemSpace API key</Label>
                  <Input variant="field"
                    id="database-query-api-key" name="api-key"
                    type="password"
                    value={draft.apiKey}
                    autoComplete="off"
                    onChange={(event) => update({ apiKey: event.target.value })}
                  />
                  <span className="text-xs text-(--color-text-secondary)">
                    Stored in your login keychain. Leave empty to use the saved key.
                  </span>
                </div>
              ) : null}
              {descriptor.needsCatalogueFilters ? (
                <>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-catalogue-providers">Suppliers</Label>
                    <Input variant="field"
                      id="database-query-catalogue-providers" autoComplete="off" name="catalogue-providers"
                      value={draft.catalogueProviders}
                      spellCheck={false}
                      placeholder="Enamine (default), any, or Enamine,Mcule"
                      onChange={(event) => update({ catalogueProviders: event.target.value })}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-min-amount">Minimum amount in stock (g)</Label>
                    <Input variant="field"
                      id="database-query-min-amount" autoComplete="off" name="min-amount"
                      type="number"
                      min={0}
                      step="0.1"
                      value={draft.minAmount}
                      placeholder="any"
                      onChange={(event) => update({ minAmount: event.target.value })}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-max-price">Maximum price (EUR)</Label>
                    <Input variant="field"
                      id="database-query-max-price" autoComplete="off" name="max-price"
                      type="number"
                      min={0}
                      value={draft.maxPrice}
                      placeholder="any"
                      onChange={(event) => update({ maxPrice: event.target.value })}
                    />
                  </div>
                </>
              ) : null}
              {descriptor.needsUrl ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label className="text-xs font-normal" htmlFor="database-query-url">Document URL</Label>
                  <Input variant="field"
                    id="database-query-url" autoComplete="off" name="url"
                    value={draft.url}
                    spellCheck={false}
                    placeholder="https://example.org/compounds.sdf.gz"
                    onChange={(event) => update({ url: event.target.value })}
                  />
                  <span className="text-xs text-(--color-text-secondary)">
                    CSV, TSV, SMILES and SDF, plain or gzipped. Addresses on the local network are refused.
                  </span>
                </div>
              ) : null}
              {descriptor.needsSql ? (
                <>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-engine">Database</Label>
                    <NativeSelect className="w-full"
                      id="database-query-engine" name="engine"
                      value={draft.sqlEngine}
                      onChange={(event) => update({ sqlEngine: event.target.value as DatabaseQueryDraft["sqlEngine"] })}
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="sqlite">SQLite</option>
                    </NativeSelect>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-connection">
                      {draft.sqlEngine === "postgres" ? "Connection URL" : "Database file"}
                    </Label>
                    <Input variant="field"
                      id="database-query-connection" autoComplete="off" name="connection"
                      value={draft.sqlConnection}
                        spellCheck={false}
                      placeholder={draft.sqlEngine === "postgres"
                        ? "postgres://user@host:5432/database"
                        : "/path/to/compounds.db"}
                      onChange={(event) => update({ sqlConnection: event.target.value })}
                    />
                  </div>
                  {draft.sqlEngine === "postgres" ? (
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label className="text-xs font-normal" htmlFor="database-query-password">Password</Label>
                      <Input variant="field"
                        id="database-query-password" name="password"
                        type="password"
                        value={draft.sqlPassword}
                        autoComplete="off"
                        onChange={(event) => update({ sqlPassword: event.target.value })}
                      />
                      <span className="text-xs text-(--color-text-secondary)">
                        Stored in your login keychain, not in settings. Leave empty to use the saved password.
                      </span>
                    </div>
                  ) : null}
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label className="text-xs font-normal" htmlFor="database-query-statement">Query</Label>
                    <Textarea
                      id="database-query-statement" autoComplete="off" name="statement"
                      className="max-h-48 resize-y font-mono"
                      value={draft.sqlStatement}
                      rows={4}
                      spellCheck={false}
                      placeholder="SELECT id, smiles, activity FROM compounds"
                      onChange={(event) => update({ sqlStatement: event.target.value })}
                    />
                    <span className="text-xs text-(--color-text-secondary)">
                      One SELECT or WITH statement. The connection is opened read-only.
                    </span>
                  </div>
                </>
              ) : null}
              {descriptor.hasBrowserFallback ? (
                <p className="text-xs text-(--color-text-secondary)">
                  If the service is unavailable or rate limiting, the same search opens in your browser.
                </p>
              ) : null}
              {descriptor.textLabel !== null ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label className="text-xs font-normal" htmlFor="database-query-text">{descriptor.textLabel}</Label>
                  <Input variant="field"
                    id="database-query-text" autoComplete="off" name="text"
                    value={draft.text}
                    spellCheck={false}
                    placeholder={descriptor.textPlaceholder}
                    onChange={(event) => update({ text: event.target.value })}
                  />
                </div>
              ) : null}
              {descriptor.fields.length > 0 ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label className="text-xs font-normal" htmlFor="database-query-field">Match against</Label>
                  <NativeSelect className="w-full"
                    id="database-query-field" name="field"
                    value={draft.field}
                    onChange={(event) => update({ field: event.target.value })}
                  >
                    {descriptor.fields.map((field) => (
                      <option key={field.id} value={field.id}>{field.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col gap-2">
                <Label className="text-xs font-normal" htmlFor="database-query-max">Maximum rows</Label>
                <ScrubNumberField disabled={busy}
                  id="database-query-max"
                  aria-label="Maximum rows"
                  className="w-full"
                  min={1}
                  max={5000}
                  value={draft.maxRecords}
                  onValueChange={(maxRecords) => update({ maxRecords })}
                />
              </div>
              </fieldset>
              {error && <p className="text-sm text-(--color-text-danger)" role="alert">{error}</p>}
              <DialogFooter className="gap-2">
                {busy && <span className="mr-auto flex items-center gap-2 text-xs text-(--color-text-secondary)" role="status"><Spinner className="size-3" aria-hidden />Starting…</span>}
                <Button type="button" variant="secondary" disabled={busy} onClick={onDismiss}>Cancel</Button>
                <Button type="submit" disabled={submitDisabled || busy}>Search</Button>
              </DialogFooter>
            </form>
          ) : null}
      </DialogContent>
    </Dialog>
  );
}
