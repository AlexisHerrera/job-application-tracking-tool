import { useEffect, useMemo, useRef, useState } from "react";
import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { Table2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FlowData } from "../api";

// Where applications went: each one walks the stages it reached, then ends where it stands now.
// Colors: stages are one ordinal blue ramp, outcomes the reserved status colors (see index.css);
// every node is also labelled with its name and count, so color never carries meaning alone.

const ORDER = ["applied", "screening", "interviewing", "offer", "in_progress", "waiting", "on_hold", "ghosted", "withdrawn", "rejected"];
const COLOR: Record<string, string> = {
  applied: "var(--flow-applied)",
  screening: "var(--flow-screening)",
  interviewing: "var(--flow-interviewing)",
  offer: "var(--flow-offer)",
  rejected: "var(--flow-rejected)",
  ghosted: "var(--flow-ghosted)",
  on_hold: "var(--flow-on-hold)",
  in_progress: "var(--flow-in-progress)",
  waiting: "var(--flow-neutral)",
  withdrawn: "var(--flow-neutral)",
};

type N = { id: string; label: string; count: number };
type L = { source: string; target: string; value: number };
type LaidNode = SankeyNode<N, L>;
type LaidLink = SankeyLink<N, L>;

const HEIGHT = 300;
const MIN_WIDTH = 560;
const LABEL_SPACE = 120; // room for the right-hand labels

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function FlowChart({ data }: { data: FlowData }) {
  const [ref, measured] = useWidth();
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const [focus, setFocus] = useState<string | null>(null); // node id whose links are highlighted
  const width = Math.max(measured, MIN_WIDTH);
  const total = data.nodes.find((n) => n.id === "applied")?.count ?? 0;

  const layout = useMemo(() => {
    if (!data.links.length) return null;
    const gen = sankey<N, L>()
      .nodeId((n) => n.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(10)
      .nodePadding(18)
      .nodeSort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
      .extent([[1, 8], [width - LABEL_SPACE, HEIGHT - 8]]);
    return gen({ nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) });
  }, [data, width]);

  const pct = (v: number) => (total ? `${Math.round((100 * v) / total)}%` : "");
  const nodeId = (n: string | number | LaidNode) => (typeof n === "object" ? n.id : String(n));

  const links = (layout?.links ?? []) as LaidLink[];
  const nodes = (layout?.nodes ?? []) as LaidNode[];
  const lit = (l: LaidLink) => !focus || nodeId(l.source) === focus || nodeId(l.target) === focus;

  return (
    <div ref={ref} className="space-y-2">
      {!layout && <p className="text-sm text-muted-foreground">No applications to chart yet.</p>}
      {layout && <>
      <div className="flex justify-end">
        <Button variant="ghost" size="xs" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? <><Waypoints /> Chart</> : <><Table2 /> Table</>}
        </Button>
      </div>
      {asTable ? (
        <Table>
          <TableHeader>
            <TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead className="text-right">Applications</TableHead><TableHead className="text-right">Share</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l) => (
              <TableRow key={`${nodeId(l.source)}-${nodeId(l.target)}`}>
                <TableCell>{(l.source as LaidNode).label}</TableCell>
                <TableCell>{(l.target as LaidNode).label}</TableCell>
                <TableCell className="text-right tabular-nums">{l.value}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{pct(l.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="relative overflow-x-auto" onMouseLeave={() => { setHover(null); setFocus(null); }}>
          <svg width={width} height={HEIGHT} role="img" aria-label={`Application flow: ${links.map((l) => `${(l.source as LaidNode).label} to ${(l.target as LaidNode).label}: ${l.value}`).join("; ")}`}>
            <g fill="none">
              {links.map((l) => {
                const target = nodeId(l.target);
                return (
                  <path
                    key={`${nodeId(l.source)}-${target}`}
                    d={sankeyLinkHorizontal()(l) ?? undefined}
                    stroke={COLOR[target] ?? "var(--flow-neutral)"}
                    strokeWidth={Math.max(2, l.width ?? 0)}
                    strokeOpacity={lit(l) ? 0.38 : 0.08}
                    className="transition-[stroke-opacity] duration-150"
                    onMouseMove={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({
                        x: e.clientX - box.left,
                        y: e.clientY - box.top,
                        text: `${(l.source as LaidNode).label} → ${(l.target as LaidNode).label}`,
                        sub: `${l.value} application${l.value === 1 ? "" : "s"} · ${pct(l.value)} of all`,
                      });
                    }}
                  />
                );
              })}
            </g>
            {nodes.map((n) => {
              const x0 = n.x0 ?? 0, x1 = n.x1 ?? 0, y0 = n.y0 ?? 0, y1 = n.y1 ?? 0;
              return (
                <g key={n.id} onMouseEnter={() => setFocus(n.id)} onMouseLeave={() => setFocus(null)}>
                  {/* hit target bigger than the mark */}
                  <rect x={x0 - 6} y={y0} width={x1 - x0 + 12} height={Math.max(y1 - y0, 12)} fill="transparent" />
                  <rect x={x0} y={y0} width={x1 - x0} height={Math.max(y1 - y0, 2)} rx={3} fill={COLOR[n.id] ?? "var(--flow-neutral)"} />
                  <text
                    x={x1 + 8}
                    y={(y0 + y1) / 2}
                    dy="0.35em"
                    className="fill-foreground text-xs font-medium"
                    style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" }}
                  >
                    {n.label} <tspan className="fill-muted-foreground font-normal tabular-nums">{n.count}</tspan>
                  </text>
                </g>
              );
            })}
          </svg>
          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
              style={{ left: Math.min(hover.x + 12, width - 200), top: hover.y + 12 }}
            >
              <div className="font-medium">{hover.text}</div>
              <div className="text-muted-foreground">{hover.sub}</div>
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  );
}
