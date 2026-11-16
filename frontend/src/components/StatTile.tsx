import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/** A headline number: a label, the value, and a line under it. */
export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
