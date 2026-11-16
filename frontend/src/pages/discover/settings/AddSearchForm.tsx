import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api/client";
import { type DiscoverySearch, type SearchSource } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { GETONBRD_CATEGORIES } from "./constants";

/** A new saved search: the source, then that source's inputs. `run` reports errors and reloads. */
export function AddSearchForm({ run }: { run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [source, setSource] = useState<SearchSource>("getonbrd");
  const [category, setCategory] = useState("programming");
  const [labelText, setLabelText] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ar");
  const [remote, setRemote] = useState(false);
  const [feed, setFeed] = useState("https://remoteyeah.com/");
  const [place, setPlace] = useState("Argentina");

  async function add() {
    const params: DiscoverySearch["params"] = source === "jsearch" ? { query, country } : source === "workable" ? { query: query.trim(), location: place.trim() } : source === "getonbrd" ? { category } : { feed };
    if (source === "jsearch" && remote) params.work_from_home = true;
    const fallback = source === "jsearch" ? `${country.toUpperCase()} · ${query}` : source === "workable" ? `Workable · ${[query.trim(), place.trim()].filter(Boolean).join(" in ")}` : source === "getonbrd" ? `getonbrd · ${category}` : feed.split("/").pop() ?? "feed";
    await run(async () => {
      await api.addSearch({ source, label: labelText || fallback, params, enabled: true });
      setLabelText("");
      setQuery("");
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2">
        <NativeSelect size="sm" value={source} onChange={(e) => setSource(e.target.value as SearchSource)} aria-label="Source">
          <NativeSelectOption value="getonbrd">getonbrd category</NativeSelectOption>
          <NativeSelectOption value="remoteyeah">remoteyeah feed</NativeSelectOption>
          <NativeSelectOption value="workable">Workable search</NativeSelectOption>
          <NativeSelectOption value="jsearch">JSearch</NativeSelectOption>
        </NativeSelect>
        <Input className="h-7 min-w-32 flex-1" placeholder="Label (optional)" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
      </div>
      {source === "jsearch" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-7 min-w-40 flex-1" placeholder='Query, e.g. "senior backend engineer"' value={query} onChange={(e) => setQuery(e.target.value)} />
          <Input className="h-7 w-16" placeholder="ar" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toLowerCase())} aria-label="Country code" />
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={remote} onCheckedChange={(c) => setRemote(c === true)} /> remote only
          </label>
        </div>
      ) : source === "workable" ? (
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
      <Button size="sm" variant="outline" disabled={source === "jsearch" ? !query.trim() : source === "workable" ? !(query.trim() || place.trim()) : source === "remoteyeah" ? !feed.endsWith(".xml") : false} onClick={add}>
        <Plus /> Add search
      </Button>
    </div>
  );
}
