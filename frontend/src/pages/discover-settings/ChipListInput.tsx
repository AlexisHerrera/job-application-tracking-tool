import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fold } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Adds what's new (ignoring case), in order; a pasted list adds one entry per line. */
function addEntries(values: string[], text: string): string[] {
  const have = new Set(values.map((v) => v.toLowerCase()));
  const out = [...values];
  for (const raw of text.split(/\r?\n/)) {
    const v = raw.replace(/\s+/g, " ").trim();
    if (v && !have.has(v.toLowerCase())) {
      have.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** A list edited as chips: type to find an entry or add one (Enter), paste a list, × to remove.
 * `counts` shows a number on each chip (how many postings it hid); `mark` adds a note to one. */
export function ChipListInput({
  values,
  onChange,
  placeholder = "Add…",
  counts,
  sortByCount = false,
  mark,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  counts?: Record<string, number>;
  sortByCount?: boolean;
  mark?: (value: string) => ReactNode;
  label: string;
}) {
  const [text, setText] = useState("");
  const query = fold(text.trim());
  const shown = values
    .filter((v) => !query || fold(v).includes(query))
    .sort((a, b) => (sortByCount && counts ? (counts[b] ?? 0) - (counts[a] ?? 0) : 0));
  const exists = values.some((v) => v.toLowerCase() === text.trim().toLowerCase());

  const add = (raw: string) => {
    onChange(addEntries(values, raw));
    setText("");
  };

  return (
    <div className="space-y-2">
      <Input
        className="h-8"
        value={text}
        placeholder={placeholder}
        aria-label={`Find or add in ${label}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            e.preventDefault();
            if (!exists) add(text);
          }
          if (e.key === "Escape") setText("");
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (pasted.includes("\n")) {
            e.preventDefault();
            add(pasted);
          }
        }}
      />
      {query && !exists && <p className="text-xs text-muted-foreground">Enter adds “{text.trim()}”.</p>}
      {shown.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {shown.map((v) => {
            const n = counts?.[v];
            return (
              <li key={v} className={cn("inline-flex h-6 max-w-full items-center gap-1 rounded-md border bg-muted/40 pl-2 text-xs", n === 0 && "border-dashed text-muted-foreground")}>
                <span className="truncate">{v}</span>
                {n !== undefined && <span className={cn("tabular-nums", n > 0 ? "font-medium text-foreground" : "text-muted-foreground")} title={`Hid ${n} stored posting${n === 1 ? "" : "s"}`}>{n}</span>}
                {mark?.(v)}
                <button type="button" className="grid h-full place-items-center rounded-r-md px-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                  <X className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{values.length === 0 ? "Empty." : "Nothing matches."}</p>
      )}
    </div>
  );
}
