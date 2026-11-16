import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DiscardHint } from "@/api/discoveryInsights";
import { KNOB } from "@/pages/discover-insights/constants";

/** The changes a reason points to, each with a link to where that knob is. */
export function HintList({ hints }: { hints: DiscardHint[] }) {
  return (
    <ul className="space-y-1">
      {hints.map((h) => (
        <li key={h.text} className="flex gap-2 text-[13px]">
          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            {h.text}{" "}
            <Link to={KNOB[h.where].to} className="text-xs whitespace-nowrap text-primary hover:underline">
              {KNOB[h.where].page} · {h.section}
            </Link>
          </span>
        </li>
      ))}
    </ul>
  );
}
