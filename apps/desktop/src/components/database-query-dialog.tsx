import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import { databaseProviderDescriptor } from "../lib/database";
import type { DatabaseQueryDraft } from "../hooks/use-app-database";
import { CloseIcon } from "./close-icon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { useAppShellPortalContainer } from "./ui/portal-container";

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
  const portalContainer = useAppShellPortalContainer();
  const [draft, setDraft] = useState<DatabaseQueryDraft | null>(query);

  // The menu can reopen the dialog for another provider while it is on screen,
  // and each provider starts from its own defaults.
  useEffect(() => {
    setDraft(query);
  }, [query]);

  const descriptor = draft ? databaseProviderDescriptor(draft.provider) : null;
  const update = (patch: Partial<DatabaseQueryDraft>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  };
  const submitDisabled = Boolean(draft && descriptor && (
    (descriptor.needsStructure && !draft.structure.trim())
    || (descriptor.needsUrl && !draft.url.trim())
    || (descriptor.needsSql && (!draft.sqlConnection.trim() || !draft.sqlStatement.trim()))
  ));

  return (
    <Dialog.Root
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog database-query-dialog" aria-describedby="database-query-description">
          <div className="radix-dialog-header">
            <Dialog.Title>{descriptor?.title ?? "Database"}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close database search">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          {draft && descriptor ? (
            <form
              className="radix-dialog-body database-query-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (submitDisabled) return;
                void onSubmit(draft);
              }}
            >
              <p id="database-query-description">{descriptor.description}</p>
              {descriptor.needsStructure ? (
                <div className="database-query-field">
                  <Label htmlFor="database-query-structure">Query structure (SMILES)</Label>
                  <Input
                    id="database-query-structure"
                    value={draft.structure}
                    autoFocus
                    spellCheck={false}
                    placeholder="CC(=O)Oc1ccccc1C(=O)O"
                    onChange={(event) => update({ structure: event.target.value })}
                  />
                  <span className="database-query-hint">
                    Draw a fragment in Ketcher and use its Database menu to fill this in.
                  </span>
                </div>
              ) : null}
              {descriptor.supportsSearchMode ? (
                <div className="database-query-field">
                  <Label htmlFor="database-query-mode">Search</Label>
                  <NativeSelect
                    id="database-query-mode"
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
                  <div className="database-query-field">
                    <Label htmlFor="database-query-threshold">Minimum similarity (%)</Label>
                    <Input
                      id="database-query-threshold"
                      type="number"
                      min={40}
                      max={100}
                      value={draft.similarityThreshold}
                      onChange={(event) => update({ similarityThreshold: Number(event.target.value) })}
                    />
                  </div>
                ) : null
              ) : null}
              {descriptor.needsApiKey ? (
                <div className="database-query-field">
                  <Label htmlFor="database-query-api-key">ChemSpace API key</Label>
                  <Input
                    id="database-query-api-key"
                    type="password"
                    value={draft.apiKey}
                    autoComplete="off"
                    onChange={(event) => update({ apiKey: event.target.value })}
                  />
                  <span className="database-query-hint">
                    Your own key from ChemSpace. Saved to your login keychain; leave empty to use the one already saved.
                  </span>
                </div>
              ) : null}
              {descriptor.needsCatalogueFilters ? (
                <>
                  <div className="database-query-field">
                    <Label htmlFor="database-query-catalogue-providers">Suppliers</Label>
                    <Input
                      id="database-query-catalogue-providers"
                      value={draft.catalogueProviders}
                      spellCheck={false}
                      placeholder="Enamine (default), any, or Enamine,Mcule"
                      onChange={(event) => update({ catalogueProviders: event.target.value })}
                    />
                  </div>
                  <div className="database-query-field">
                    <Label htmlFor="database-query-min-amount">Minimum amount in stock (g)</Label>
                    <Input
                      id="database-query-min-amount"
                      type="number"
                      min={0}
                      step="0.1"
                      value={draft.minAmount}
                      placeholder="any"
                      onChange={(event) => update({ minAmount: event.target.value })}
                    />
                  </div>
                  <div className="database-query-field">
                    <Label htmlFor="database-query-max-price">Maximum price (EUR)</Label>
                    <Input
                      id="database-query-max-price"
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
                <div className="database-query-field">
                  <Label htmlFor="database-query-url">Document URL</Label>
                  <Input
                    id="database-query-url"
                    value={draft.url}
                    autoFocus
                    spellCheck={false}
                    placeholder="https://example.org/compounds.sdf.gz"
                    onChange={(event) => update({ url: event.target.value })}
                  />
                  <span className="database-query-hint">
                    CSV, TSV, SMILES and SDF, plain or gzipped. Addresses on the local network are refused.
                  </span>
                </div>
              ) : null}
              {descriptor.needsSql ? (
                <>
                  <div className="database-query-field">
                    <Label htmlFor="database-query-engine">Database</Label>
                    <NativeSelect
                      id="database-query-engine"
                      value={draft.sqlEngine}
                      onChange={(event) => update({ sqlEngine: event.target.value as DatabaseQueryDraft["sqlEngine"] })}
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="sqlite">SQLite</option>
                    </NativeSelect>
                  </div>
                  <div className="database-query-field">
                    <Label htmlFor="database-query-connection">
                      {draft.sqlEngine === "postgres" ? "Connection URL" : "Database file"}
                    </Label>
                    <Input
                      id="database-query-connection"
                      value={draft.sqlConnection}
                      autoFocus
                      spellCheck={false}
                      placeholder={draft.sqlEngine === "postgres"
                        ? "postgres://user@host:5432/database"
                        : "/path/to/compounds.db"}
                      onChange={(event) => update({ sqlConnection: event.target.value })}
                    />
                  </div>
                  {draft.sqlEngine === "postgres" ? (
                    <div className="database-query-field">
                      <Label htmlFor="database-query-password">Password</Label>
                      <Input
                        id="database-query-password"
                        type="password"
                        value={draft.sqlPassword}
                        autoComplete="off"
                        onChange={(event) => update({ sqlPassword: event.target.value })}
                      />
                      <span className="database-query-hint">
                        Saved to your login keychain, not to Burette's settings. Leave empty to use the one already saved.
                      </span>
                    </div>
                  ) : null}
                  <div className="database-query-field">
                    <Label htmlFor="database-query-statement">Query</Label>
                    <textarea
                      id="database-query-statement"
                      className="database-query-statement"
                      value={draft.sqlStatement}
                      rows={4}
                      spellCheck={false}
                      placeholder="SELECT id, smiles, activity FROM compounds"
                      onChange={(event) => update({ sqlStatement: event.target.value })}
                    />
                    <span className="database-query-hint">
                      One SELECT or WITH statement. The connection is opened read-only.
                    </span>
                  </div>
                </>
              ) : null}
              {descriptor.hasBrowserFallback ? (
                <p className="database-query-hint">
                  If the service is unavailable or rate limiting, the same search opens in your browser.
                </p>
              ) : null}
              {descriptor.textLabel !== null ? (
                <div className="database-query-field">
                  <Label htmlFor="database-query-text">{descriptor.textLabel}</Label>
                  <Input
                    id="database-query-text"
                    value={draft.text}
                    autoFocus={!descriptor.needsStructure}
                    spellCheck={false}
                    placeholder={descriptor.textPlaceholder}
                    onChange={(event) => update({ text: event.target.value })}
                  />
                </div>
              ) : null}
              {descriptor.fields.length > 0 ? (
                <div className="database-query-field">
                  <Label htmlFor="database-query-field">Match against</Label>
                  <NativeSelect
                    id="database-query-field"
                    value={draft.field}
                    onChange={(event) => update({ field: event.target.value })}
                  >
                    {descriptor.fields.map((field) => (
                      <option key={field.id} value={field.id}>{field.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <div className="database-query-field">
                <Label htmlFor="database-query-max">Maximum rows</Label>
                <Input
                  id="database-query-max"
                  type="number"
                  min={1}
                  max={5000}
                  value={draft.maxRecords}
                  onChange={(event) => update({ maxRecords: Number(event.target.value) })}
                />
              </div>
              <div className="database-query-actions">
                <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>Cancel</Button>
                <Button type="submit" size="sm" disabled={submitDisabled}>Search</Button>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
