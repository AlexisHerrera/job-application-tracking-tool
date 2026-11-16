import { Card, CardContent } from "@/components/ui/card";
import type { Interview } from "@/api";
import { GeneralTalkRow } from "./GeneralTalkRow";
import { InterviewLink } from "./InterviewLink";

export function InterviewGroup({ title, items, empty }: { title: string; items: Interview[]; empty: string }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-sm font-medium">{title} · {items.length}</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {items.map((iv) => (iv.general ? <GeneralTalkRow key={iv.id} iv={iv} /> : <InterviewLink key={iv.id} iv={iv} />))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
