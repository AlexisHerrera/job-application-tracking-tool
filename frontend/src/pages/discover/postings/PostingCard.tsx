import { ChevronDown, ExternalLink } from "lucide-react";
import { daysAgo } from "@/lib/format";
import { type Posting } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { safeUrl } from "@/lib/links";
import { salaryOf, usdSalary } from "@/pages/discover/format";
import { PostingActions } from "./PostingActions";
import { PostingChips } from "./PostingChips";
import { PostingTechTags } from "./PostingTechTags";
import { VerdictBadge } from "./VerdictBadge";

export function PostingCard({ p, onChange, onBlocked, onTech }: { p: Posting; onChange: () => void; onBlocked: () => void; onTech: (tech: string) => void }) {
  const url = safeUrl(p.url);
  const salary = salaryOf(p) ?? usdSalary(p);
  const meta = [p.location, salary, p.employment_type, p.posted_at ? `posted ${daysAgo(p.posted_at)}` : null, p.publisher ? `via ${p.publisher}` : null].filter(Boolean);

  return (
    <Card className={cn("gap-3 py-4", p.status === "dismissed" && "opacity-60")}>
      <CardContent className="space-y-2.5 px-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge p={p} />
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium break-words hover:underline">
                  {p.title} <ExternalLink className="inline size-3.5 align-[-2px] text-muted-foreground" />
                </a>
              ) : (
                <span className="font-medium break-words">{p.title}</span>
              )}
            </div>
            <div className="mt-0.5 text-sm">
              <span className="font-medium">{p.company}</span>
              {meta.length > 0 && <span className="text-muted-foreground"> · {meta.join(" · ")}</span>}
            </div>
          </div>
          {p.search_label && <span className="text-xs text-muted-foreground">{p.search_label}</span>}
        </div>

        <PostingChips p={p} />

        {p.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {p.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        <PostingTechTags p={p} onTech={onTech} />

        <Collapsible>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <PostingActions p={p} onChange={onChange} onBlocked={onBlocked} />
            {p.description && (
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground">
                  Description <ChevronDown />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
          <CollapsibleContent>
            <p className="mt-2 max-h-96 overflow-y-auto rounded-md bg-muted/50 p-3 font-serif text-[0.9375rem] leading-relaxed whitespace-pre-line">{p.description}</p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
