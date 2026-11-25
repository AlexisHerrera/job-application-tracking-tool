import { Card, CardContent } from "@/components/ui/card";
import { Loading, PageHeader } from "@/components/common";
import { api } from "@/api/client";
import type { Fact } from "@/api/apply";
import { useAsync } from "@/lib/useAsync";
import { AddFactForm } from "./AddFactForm";
import { FactRow } from "./FactRow";

export default function ApplyFactsPage() {
  const { data, error, loading, setData } = useAsync(api.applyFacts);
  const put = (f: Fact) => setData((d) => d && d.map((x) => (x.key === f.key ? f : x)));
  const filled = data?.filter((f) => f.value).length ?? 0;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Facts"
        description={`The short answers every form asks the same way: where you live, visa, pay, languages, links.${data ? ` ${filled} of ${data.length} filled in.` : ""}`}
      />
      <Loading error={error} loading={loading && !data} />
      {data && (
        <Card>
          <CardContent className="divide-y">
            {data.map((f) => (
              <FactRow key={f.key} fact={f} onSaved={put} onDeleted={() => setData((d) => d && d.filter((x) => x.key !== f.key))} />
            ))}
            <AddFactForm onAdded={(f) => setData((d) => (d ? [...d, f] : [f]))} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
