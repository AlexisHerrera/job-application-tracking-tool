import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/common";

export function ListCard({ icon, title, description, empty, children }: { icon: ReactNode; title: string; description?: string; empty: string; children: ReactNode[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {children.length > 0 && <CardAction><span className="text-sm text-muted-foreground tabular-nums">{children.length}</span></CardAction>}
      </CardHeader>
      <CardContent>
        {children.length === 0 ? <Empty>{empty}</Empty> : <div className="divide-y">{children}</div>}
      </CardContent>
    </Card>
  );
}
