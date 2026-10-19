import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { daysAgo, fmtDate, label, type Application } from "./api";
import { StatusBadge } from "./components";

// Searchable application picker (ARIA combobox). Type any part of the company, role, status,
// source or location; every word must match. Suggested applications are listed first.

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

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
      <div className="picker picker-selected">
        <button type="button" className="picker-chosen" onClick={() => setOpen(true)} title="Change">
          <strong>{selected.company}</strong> · {selected.role_title} <StatusBadge status={selected.status} />
        </button>
        <button type="button" className="link" aria-label="Clear selection" onClick={() => onChange("")}>✕</button>
      </div>
    );
  }

  return (
    <div className="picker" ref={root}>
      <input
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
        <ul className="picker-list" role="listbox" id={listId}>
          {results.length === 0 && <li className="picker-empty muted">No application matches “{query}”.</li>}
          {results.map((a, i) => (
            <li
              key={a.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "picker-option active" : "picker-option"}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus; choose before the input blurs
                choose(a);
              }}
            >
              <div className="picker-line">
                <strong>{a.company}</strong>
                {suggested.includes(a.id) && <span className="badge badge-review">suggested</span>}
                <StatusBadge status={a.status} />
              </div>
              <div className="picker-line muted small">
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
