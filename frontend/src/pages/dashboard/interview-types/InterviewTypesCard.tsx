import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Insights } from "@/api/dashboard";
import { InterviewTypeRow } from "./InterviewTypeRow";
import { OutcomeLegend } from "./OutcomeLegend";

/** What came after each interview, by type. A row opens its interviews, where the type can be fixed. */
export function InterviewTypesCard({ data }: { data: Insights }) {
  const rows = data.interview_types;
  const max = Math.max(1, ...rows.map((r) => r.done));
  const [open, setOpen] = useState<Set<string>>(() => new Set(["not_set"]));
  const toggle = (t: string) => setOpen((s) => new Set(s.has(t) ? [...s].filter((x) => x !== t) : [...s, t]));
  const rated = rows.some((r) => r.rated > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessagesSquare className="size-4 text-muted-foreground" /> How interviews went</CardTitle>
        <CardDescription>What came after each interview, by type. Open a type to see its interviews and fix their types.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No interviews yet.</p>
        ) : (
          <>
            <OutcomeLegend />
            <div className="divide-y">
              {rows.map((r) => <InterviewTypeRow key={r.type} row={r} scale={r.done / max} open={open.has(r.type)} onToggle={() => toggle(r.type)} />)}
            </div>
            {!rated && <p className="text-xs text-muted-foreground">Rate yourself in an interview's notes to see how it lines up with what came after.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
