import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtDate, fmtSalary, type Application } from "../../api";
import { ReviewBadge, StatusBadge } from "../../components/common";
import { STATUS_ORDER } from "../../lib/status";
import { shortAgo } from "./Board";

type SortKey = "company" | "status" | "applied_at" | "last_event_at" | "next_interview_at" | "salary";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "company", label: "Company" },
  { key: "status", label: "Status" },
  { key: "applied_at", label: "Applied", className: "hidden md:table-cell" },
  { key: "last_event_at", label: "Last activity", className: "hidden sm:table-cell" },
  { key: "next_interview_at", label: "Next interview", className: "hidden lg:table-cell" },
  { key: "salary", label: "Salary", className: "hidden xl:table-cell" },
];

function value(a: Application, key: SortKey): string | number {
  switch (key) {
    case "company": return a.company.toLowerCase();
    case "status": return STATUS_ORDER.indexOf(a.status);
    case "salary": return a.salary_max ?? a.salary_min ?? -1;
    default: return a[key] ? new Date(a[key]!).getTime() : -1;
  }
}

export function AllTable({ apps, onOpen }: { apps: Application[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "last_event_at", desc: true });
  const rows = useMemo(() => {
    const sign = sort.desc ? -1 : 1;
    return [...apps].sort((a, b) => {
      const va = value(a, sort.key), vb = value(b, sort.key);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sign;
    });
  }, [apps, sort]);

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead key={c.key} className={c.className} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                  onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : c.key !== "company" && c.key !== "status" })}
                >
                  {c.label}
                  {sort.key === c.key && (sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => {
            const upcoming = a.next_interview_at && new Date(a.next_interview_at) > new Date();
            return (
              <TableRow
                key={a.id}
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => onOpen(a.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(a.id)}
              >
                <TableCell className="max-w-72">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{a.company}</span>
                    {a.needs_review && <ReviewBadge />}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{a.role_title}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} />
                  {a.current_round ? <span className="ml-1.5 text-xs text-muted-foreground">R{a.current_round}</span> : null}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{fmtDate(a.applied_at)}</TableCell>
                <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">{shortAgo(a.last_event_at ?? a.applied_at)}</TableCell>
                <TableCell className={cn("hidden lg:table-cell", upcoming ? "text-violet-700 dark:text-violet-300" : "text-muted-foreground")}>
                  {upcoming ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{fmtDate(a.next_interview_at, true)}</span> : "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{fmtSalary(a) ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
