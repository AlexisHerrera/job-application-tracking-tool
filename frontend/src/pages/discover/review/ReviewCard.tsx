import { ExternalLink, Sparkles } from "lucide-react";
import type { Posting } from "@/api/discovery";
import { Kbd } from "@/components/ui/kbd";
import { daysAgo } from "@/lib/format";
import { safeUrl } from "@/lib/links";
import { PostingTechTags } from "@/pages/discover/postings/PostingTechTags";
import { ReviewFacts } from "./ReviewFacts";
import { ScoreRing } from "./ScoreRing";

const HEADING = "mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase";

/** One posting, big: the verdict and what decides it on the left, the full description on the right. */
export function ReviewCard({ p, onTech }: { p: Posting; onTech: (tech: string) => void }) {
  const url = safeUrl(p.url);
  const meta = [p.employment_type, p.posted_at ? `posted ${daysAgo(p.posted_at)}` : null, p.publisher ? `via ${p.publisher}` : null, p.search_label].filter(Boolean);

  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <ScoreRing p={p} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{p.title}</h2>
            <p className="mt-1 text-base">
              <span className="font-medium">{p.company}</span>
              {meta.length > 0 && <span className="text-sm text-muted-foreground"> · {meta.join(" · ")}</span>}
            </p>
            {p.in_tracker && p.status !== "applied" && <p className="mt-1.5 text-xs font-medium text-warn">This company is already in your tracker</p>}
          </div>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-input px-4 text-sm font-medium hover:bg-accent">
            Open posting <ExternalLink className="size-4" /> <Kbd className="pointer-coarse:hidden">O</Kbd>
          </a>
        )}
      </header>

      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          {p.reasons.length > 0 && (
            <section>
              <h3 className={HEADING}><Sparkles className="mr-1 inline size-3.5 align-[-2px]" />Why the AI scored it this way</h3>
              <ul className="space-y-1.5 text-sm">
                {p.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />{r}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className={HEADING}>At a glance</h3>
            <ReviewFacts p={p} />
          </section>
          {(p.technologies.length > 0 || p.stack_overlap.length > 0) && (
            <section>
              <h3 className={HEADING}>Stack <span className="font-normal normal-case">(highlighted: on your CV)</span></h3>
              <PostingTechTags p={p} onTech={onTech} />
            </section>
          )}
        </div>
        <section className="min-w-0 lg:col-span-3">
          <h3 className={HEADING}>Description</h3>
          {p.description ? (
            <p className="max-h-[34rem] overflow-y-auto rounded-lg bg-muted/50 p-4 font-serif text-[0.9375rem] leading-relaxed whitespace-pre-line">{p.description}</p>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">The source gave no description. Open the posting to read it.</p>
          )}
        </section>
      </div>
    </article>
  );
}
