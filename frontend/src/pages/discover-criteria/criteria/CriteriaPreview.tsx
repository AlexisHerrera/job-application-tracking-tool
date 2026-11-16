import type { CriteriaPreview as Preview } from "@/api/discoverySettings";
import { cn } from "@/lib/utils";

/** "What the AI reads": the text the fields render to, and its length against the cut. */
export function CriteriaPreview({ preview, error }: { preview: Preview | null; error: string | null }) {
  const over = preview ? preview.chars > preview.limit : false;
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-medium">What the AI reads</h3>
        {preview && (
          <span className={cn("text-xs tabular-nums", over ? "font-medium text-destructive" : "text-muted-foreground")}>
            {preview.chars.toLocaleString()} / {preview.limit.toLocaleString()}
          </span>
        )}
      </div>
      {error ? (
        <p className="p-3 text-xs text-destructive">{error}</p>
      ) : (
        <pre className="max-h-[28rem] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{preview?.text ?? "…"}</pre>
      )}
      {over && <p className="border-t px-3 py-2 text-xs text-destructive">Too long to save: shorten the notes or the background.</p>}
    </section>
  );
}
