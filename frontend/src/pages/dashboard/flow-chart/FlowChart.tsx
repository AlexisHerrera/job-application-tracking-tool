import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { sankey } from "d3-sankey";
import { Table2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FlowData } from "@/api/dashboard";
import { build, type FlowLink, type FlowNode } from "@/lib/flow";
import { chainPath, color, HEIGHT, LABEL_SPACE, MIN_WIDTH, rank, WIDE_LABEL_SPACE, type LaidLink, type LaidNode } from "./layout";
import { useWidth } from "@/lib/useWidth";

// Where applications went, read left to right: one column per stage, and each stage's exits
// (no reply, ghosted, rejected…) sit in the column right after it, so no flow crosses the chart.
// An application that skipped a stage passes through an invisible waypoint above that stage.
// Colors live in index.css (--flow-*): an indigo ramp for progress, neutral grays for "no answer",
// hue only for offer / on hold / rejected. Every node is labelled with its count and share.
// Clicking a node or a flow selects it: a key that `inFlow` matches against an application's path.

export function FlowChart({ data, onSelect }: { data: FlowData; onSelect?: (key: string) => void }) {
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
    const lastCol = Math.max(...graph.nodes.map((n) => n.col));
    const room = graph.nodes.some((n) => n.col === lastCol && n.label.length > 14) ? WIDE_LABEL_SPACE : LABEL_SPACE;
    return sankey<FlowNode, FlowLink>()
      .nodeId((n) => n.id)
      .nodeAlign((n) => n.col)
      .nodeWidth(12)
      .nodePadding(22)
      .nodeSort((a, b) => rank(a) - rank(b))
      .extent([[1, 26], [width - room, HEIGHT - 4]])(graph);
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
                        className={`transition-[stroke-opacity] duration-150${onSelect ? " cursor-pointer" : ""}`}
                        onClick={() => onSelect?.(l.chain)}
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
                    <g
                      key={n.id}
                      onMouseEnter={() => { setFocus(n.id); setHover(null); }}
                      opacity={dim ? 0.35 : 1}
                      className={`transition-opacity duration-150 outline-none${onSelect ? " cursor-pointer" : ""}`}
                      {...(onSelect && {
                        role: "link",
                        tabIndex: 0,
                        "aria-label": `${n.label}: ${n.value} applications`,
                        onClick: () => onSelect(n.id),
                        onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && onSelect(n.id),
                        onFocus: () => setFocus(n.id),
                        onBlur: () => setFocus(null),
                      })}
                    >
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
