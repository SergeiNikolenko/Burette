import { useState } from "react";
import { DatabaseQueryDialog } from "@/components/database-query-dialog";
import { databaseQueryDraft, type DatabaseQueryDraft } from "@/hooks/use-app-database";
import { DATABASE_PROVIDERS, type DatabaseProvider } from "@/lib/database";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function DatabaseExample() {
  const [provider, setProvider] = useState<DatabaseProvider>("chembl");
  const [query, setQuery] = useState<DatabaseQueryDraft | null>(null);
  const [result, setResult] = useState("");
  return <section aria-label="Database examples" className="flex flex-wrap items-center gap-2">
    <NativeSelect aria-label="Source" value={provider} onChange={event => setProvider(event.target.value as DatabaseProvider)}>
      {Object.values(DATABASE_PROVIDERS).map(item => <NativeSelectOption key={item.provider} value={item.provider}>{item.title}</NativeSelectOption>)}
    </NativeSelect>
    <Button variant="secondary" onClick={() => setQuery(databaseQueryDraft(provider))}>Database search</Button>
    {result && <output className="text-sm">{result}</output>}
    <DatabaseQueryDialog query={query} onDismiss={() => setQuery(null)} onSubmit={draft => {
      // Record only the source and limit: no network request, secret storage or query logging.
      setResult(`${DATABASE_PROVIDERS[draft.provider].title}: ${draft.maxRecords} rows`); setQuery(null);
    }} />
  </section>;
}
