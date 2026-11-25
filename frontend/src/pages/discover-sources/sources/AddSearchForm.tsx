import { PendingButton } from "@/components/PendingButton";
import { usePending } from "@/lib/usePending";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api/client";
import { type DiscoverySearch, type SearchSource } from "@/api/discovery";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { GETONBRD_CATEGORIES } from "./constants";

/** A new saved search: the source, then that source's inputs. `run` reports errors and reloads. */
export function AddSearchForm({ run }: { run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { pending, run: runPending } = usePending<"add">();
  const [source, setSource] = useState<SearchSource>("getonbrd");
  const [category, setCategory] = useState("programming");
  const [labelText, setLabelText] = useState("");
  const [query, setQuery] = useState("");
  const [feed, setFeed] = useState("https://remoteyeah.com/");
  const [place, setPlace] = useState("Argentina");

  async function add() {
    const params: DiscoverySearch["params"] = source === "workable" ? { query: query.trim(), location: place.trim() } : source === "getonbrd" ? { category } : { feed };
    const fallback = source === "workable" ? `Workable · ${[query.trim(), place.trim()].filter(Boolean).join(" in ")}` : source === "getonbrd" ? `getonbrd · ${category}` : feed.split("/").pop() ?? "feed";
    await runPending("add", () => run(async () => {
      await api.addSearch({ source, label: labelText || fallback, params, enabled: true });
      setLabelText("");
      setQuery("");
    }));
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2">
        <NativeSelect size="sm" value={source} onChange={(e) => setSource(e.target.value as SearchSource)} aria-label="Source">
          <NativeSelectOption value="getonbrd">getonbrd category</NativeSelectOption>
          <NativeSelectOption value="remoteyeah">remoteyeah feed</NativeSelectOption>
          <NativeSelectOption value="workable">Workable search</NativeSelectOption>
        </NativeSelect>
        <Input className="h-7 min-w-32 flex-1" placeholder="Label (optional)" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
      </div>
      {source === "workable" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-7 min-w-40 flex-1" placeholder='Words, e.g. "engineer"' value={query} onChange={(e) => setQuery(e.target.value)} />
          <Input className="h-7 w-40" placeholder="Country or city" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Location" />
        </div>
      ) : source === "getonbrd" ? (
        <NativeSelect size="sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          {GETONBRD_CATEGORIES.map((c) => (
            <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <Input className="h-7" placeholder="https://remoteyeah.com/remote-…-jobs.xml" value={feed} onChange={(e) => setFeed(e.target.value)} />
      )}
      <PendingButton pending={pending !== null} size="sm" variant="outline" disabled={source === "workable" ? !(query.trim() || place.trim()) : source === "remoteyeah" ? !feed.endsWith(".xml") : false} onClick={add}>
        {!pending && <Plus />} Add search
      </PendingButton>
    </div>
  );
}
