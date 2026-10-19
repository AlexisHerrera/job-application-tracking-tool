import { useEffect, useId, useMemo, useRef, useState } from "react";
import { sankey, type SankeyLink, type SankeyNode } from "d3-sankey";
import { Table2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FlowData } from "../api";

// Where applications went, read left to right: one column per stage, and each stage's exits
// (no reply, ghosted, rejected…) sit in the column right after it, so no flow crosses the chart.
// An application that skipped a stage passes through an invisible waypoint above that stage.
// Colors live in index.css (--flow-*): an indigo ramp for progress, neutral grays for "no answer",
// hue only for offer / on hold / rejected. Every node is labelled with its count and share.

const STAGE_COL: Record<string, number> = { applied: 0, screening: 1, interviewing: 2, offer: 3 };
const OUTCOME_ORDER = ["in_progress", "waiting", "on_hold", "ghosted", "withdrawn", "rejected"];

type Kind = "stage" | "outcome" | "via";
type N = { id: string; key: string; label: string; kind: Kind; col: number };
// `from` / `to` are the real endpoints, so the segments of a skipped-stage flow act as one.
type L = { source: string; target: string; value: number; from: string; to: string; chain: string };
type LaidNode = SankeyNode<N, L>;
type LaidLink = SankeyLink<N, L>;

const HEIGHT = 340;
const MIN_WIDTH = 600;
const LABEL_SPACE = 132; // room for the labels of the last column

const color = (key: string) => `var(--flow-${key.replace("_", "-")})`;

function build(data: FlowData) {
  const labels = Object.fromEntries(data.nodes.map((n) => [n.id, n.label]));
  const nodes = new Map<string, N>();
  const links: L[] = [];
  const add = (n: N) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  for (const l of data.links) {
    const from = STAGE_COL[l.source];
    if (from === undefined) continue; // flows always start at a progress stage
    const src = add({ id: l.source, key: l.source, label: labels[l.source], kind: "stage", col: from });
    if (l.target in STAGE_COL) {
      const to = add({ id: l.target, key: l.target, label: labels[l.target], kind: "stage", col: STAGE_COL[l.target] });
      const chain = `${src}->${to}`;
      let prev = src;
      for (let c = from + 1; c < STAGE_COL[l.target]; c++) {
        const via = add({ id: `via:${l.target}@${c}`, key: l.target, label: "", kind: "via", col: c });
        links.push({ source: prev, target: via, value: l.value, from: src, to, chain });
        prev = via;
      }
      links.push({ source: prev, target: to, value: l.value, from: src, to, chain });
    } else {
      const to = add({ id: `${l.target}@${l.source}`, key: l.target, label: labels[l.target], kind: "outcome", col: from + 1 });
      links.push({ source: src, target: to, value: l.value, from: src, to, chain: `${src}->${to}` });
    }
  }
  return { nodes: [...nodes.values()], links };
}

// Within a column: pass-through waypoints on top, then the stage, then its exits.
function rank(n: N): number {
  if (n.kind === "via") return 0;
  if (n.kind === "stage") return 1;
  return 2 + OUTCOME_ORDER.indexOf(n.key);
}

/** A horizontal sankey band through any waypoints: curve between columns, straight across them. */
function chainPath(segs: LaidLink[]): string {
  const x = (n: LaidNode | string | number, side: "x0" | "x1") => (n as LaidNode)[side] ?? 0;
  const curve = (xa: number, ya: number, xb: number, yb: number) => {
    const xm = (xa + xb) / 2;
    return `C${xm},${ya} ${xm},${yb} ${xb},${yb}`;
  };
  let d = `M${x(segs[0].source, "x1")},${segs[0].y0}`;
  segs.forEach((l, i) => {
    const xa = x(l.source, "x1"), xb = x(l.target, "x0");
    if (i > 0) d += `L${xa},${l.y0}`;
    d += curve(xa, l.y0 ?? 0, xb, l.y1 ?? 0);
  });
  return d;
}

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
  const uid = useId().replace(/:/g, "");
  const [ref, measured] = useWidth();
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const [focus, setFocus] = useState<string | null>(null); // a node id or a flow chain
  const width = Math.max(measured, MIN_WIDTH);
  const labels = Object.fromEntries(data.nodes.map((n) => [n.id, n.label]));
  const total = data.nodes.find((n) => n.id === "applied")?.count ?? 0;
  const pct = (v: number) => (total ? `${Math.round((100 * v) / total)}%` : "");

  const layout = useMemo(() => {
    const graph = build(data);
    if (!graph.links.length) return null;
    return sankey<N, L>()
      .nodeId((n) => n.id)
      .nodeAlign((n) => n.col)
      .nodeWidth(12)
      .nodePadding(22)
      .nodeSort((a, b) => rank(a) - rank(b))
      .extent([[1, 26], [width - LABEL_SPACE, HEIGHT - 4]])(graph);
  }, [data, width]);

  const nodes = (layout?.nodes ?? []) as LaidNode[];
  const links = (layout?.links ?? []) as LaidLink[];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lit = (l: LaidLink) => !focus || focus === l.chain || focus === l.from || focus === l.to;
  // One band per real flow: a skipped stage's segments are joined into a single path (no seams).
  const chains = new Map<string, LaidLink[]>();
  for (const l of links) chains.set(l.chain, [...(chains.get(l.chain) ?? []), l]);
  const bands = [...chains.values()].map((segs) => ({
    first: segs[0],
    d: chainPath(segs),
    x0: (segs[0].source as LaidNode).x1 ?? 0,
    x1: (segs[segs.length - 1].target as LaidNode).x0 ?? 0,
  }));

  return (
    <div ref={ref} className="space-y-2">
      {!layout && <p className="text-sm text-muted-foreground">No applications to chart yet.</p>}
      {layout && (
        <>
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
                {data.links.map((l) => (
                  <TableRow key={`${l.source}-${l.target}`}>
                    <TableCell>{labels[l.source]}</TableCell>
                    <TableCell>{labels[l.target]}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.value}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{pct(l.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="relative overflow-x-auto" onMouseLeave={() => { setHover(null); setFocus(null); }}>
              <svg
                width={width}
                height={HEIGHT}
                role="img"
                aria-label={`Application flow: ${data.links.map((l) => `${labels[l.source]} to ${labels[l.target]}: ${l.value}`).join("; ")}`}
              >
                <defs>
                  {bands.map((b, i) => (
                    <linearGradient key={i} id={`${uid}-g${i}`} gradientUnits="userSpaceOnUse" x1={b.x0} x2={b.x1}>
                      <stop offset="0%" stopColor={color(byId.get(b.first.from)!.key)} />
                      <stop offset="100%" stopColor={color(byId.get(b.first.to)!.key)} />
                    </linearGradient>
                  ))}
                </defs>
                <g fill="none">
                  {bands.map(({ first: l, d }, i) => {
                    const from = byId.get(l.from)!, to = byId.get(l.to)!;
                    return (
                      <path
                        key={i}
                        d={d}
                        stroke={`url(#${uid}-g${i})`}
                        strokeWidth={Math.max(1.5, l.width ?? 0)}
                        strokeOpacity={lit(l) ? 0.42 : 0.08}
                        className="transition-[stroke-opacity] duration-150"
                        onMouseEnter={() => setFocus(l.chain)}
                        onMouseMove={(e) => {
                          const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                          setHover({
                            x: e.clientX - box.left,
                            y: e.clientY - box.top,
                            text: `${from.label} → ${to.label}`,
                            sub: `${l.value} application${l.value === 1 ? "" : "s"} · ${pct(l.value)} of all`,
                          });
                        }}
                      />
                    );
                  })}
                </g>
                {nodes.map((n) => {
                  const x0 = n.x0 ?? 0, x1 = n.x1 ?? 0, y0 = n.y0 ?? 0, y1 = n.y1 ?? 0;
                  if (n.kind === "via") return null; // drawn as part of its band
                  const hasOut = (n.sourceLinks?.length ?? 0) > 0;
                  const dim = focus && focus !== n.id && !links.some((l) => lit(l) && (l.from === n.id || l.to === n.id));
                  return (
                    <g key={n.id} onMouseEnter={() => { setFocus(n.id); setHover(null); }} opacity={dim ? 0.35 : 1} className="transition-opacity duration-150">
                      <rect x={x0 - 6} y={y0 - 4} width={x1 - x0 + 12} height={Math.max(y1 - y0, 4) + 8} fill="transparent" />
                      <rect x={x0} y={y0} width={x1 - x0} height={Math.max(y1 - y0, 3)} rx={3} fill={color(n.key)} />
                      {/* Stages with onward flows are labelled above; exits to their right. */}
                      <text
                        x={hasOut ? x0 : x1 + 8}
                        y={hasOut ? y0 - 8 : (y0 + y1) / 2}
                        dy={hasOut ? 0 : "0.35em"}
                        className="fill-foreground text-xs font-medium"
                        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4, strokeLinejoin: "round" }}
                      >
                        {n.label}
                        <tspan className="fill-muted-foreground font-normal tabular-nums"> {n.value} · {pct(n.value ?? 0)}</tspan>
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
        </>
      )}
    </div>
  );
}
