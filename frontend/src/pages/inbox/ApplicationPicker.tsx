import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { daysAgo, fmtDate, label, type Application } from "@/api";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fold } from "@/lib/text";
import { ReviewBadge, StatusBadge } from "@/components/common";

// Searchable application picker (ARIA combobox). Type any part of the company, role, status,
// source or location; every word must match. Suggested applications are listed first.

function haystack(a: Application) {
  return fold([a.company, a.role_title, label(a.status), a.source_ats, a.source_channel, a.location].filter(Boolean).join(" "));
}

function usefulDate(a: Application): string {
  if (a.next_interview_at && new Date(a.next_interview_at) > new Date()) return `interview ${fmtDate(a.next_interview_at, true)}`;
  if (a.last_event_at) return `last activity ${daysAgo(a.last_event_at)}`;
  return `applied ${fmtDate(a.applied_at)}`;
}

const CLOSED = new Set(["rejected", "withdrawn", "offer"]);

export function ApplicationPicker({
  apps,
  value,
  onChange,
  suggested = [],
  placeholder = "Search company, role, status…",
}: {
  apps: Application[];
  value: string;
  onChange: (id: string) => void;
  suggested?: string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = apps.find((a) => a.id === value) ?? null;

  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const rank = (a: Application) =>
      (suggested.includes(a.id) ? 0 : 2) + (CLOSED.has(a.status) ? 1 : 0);
    return apps
      .filter((a) => {
        const h = haystack(a);
        return words.every((w) => h.includes(w));
      })
      .sort((a, b) => rank(a) - rank(b) || (b.last_event_at ?? b.applied_at ?? "").localeCompare(a.last_event_at ?? a.applied_at ?? ""))
      .slice(0, 50);
  }, [apps, query, suggested]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (a: Application) => {
    onChange(a.id);
    setQuery("");
    setOpen(false);
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (selected && !open) {
    return (
      <div className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg border bg-muted/40 pr-1 pl-2.5 text-sm">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(true)} title="Change">
          <strong className="truncate">{selected.company}</strong>
          <span className="truncate text-muted-foreground">{selected.role_title}</span>
          <StatusBadge status={selected.status} />
        </button>
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Clear selection" onClick={() => onChange("")}><X className="size-3.5" /></button>
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1" ref={root}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={query}
        autoFocus={!!selected}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-80 w-full min-w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md" role="listbox" id={listId}>
          {results.length === 0 && <li className="p-2 text-sm text-muted-foreground">No application matches “{query}”.</li>}
          {results.map((a, i) => (
            <li
              key={a.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn("cursor-pointer rounded-md px-2 py-1.5 text-sm", i === active && "bg-accent text-accent-foreground")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus; choose before the input blurs
                choose(a);
              }}
            >
              <div className="flex items-center gap-2">
                <strong>{a.company}</strong>
                {suggested.includes(a.id) && <ReviewBadge>suggested</ReviewBadge>}
                {a.needs_review && <ReviewBadge />}
                <StatusBadge status={a.status} />
              </div>
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>{a.role_title}</span>
                <span>{usefulDate(a)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
