import type { SankeyLink, SankeyNode } from "d3-sankey";
import type { FlowLink, FlowNode } from "@/lib/flow";

const OUTCOME_ORDER = ["in_progress", "waiting", "on_hold", "ghosted", "withdrawn", "rejected"];

export type LaidNode = SankeyNode<FlowNode, FlowLink>;
export type LaidLink = SankeyLink<FlowNode, FlowLink>;

export const HEIGHT = 340;
export const MIN_WIDTH = 600;
export const LABEL_SPACE = 132; // room for the labels of the last column
export const WIDE_LABEL_SPACE = 196; // ... when they read "Rejected after interviews"

export const color = (key: string) => `var(--flow-${key.replace("_", "-")})`;

// Within a column: pass-through waypoints on top, then the stage, then its exits.
export function rank(n: FlowNode): number {
  if (n.kind === "via") return 0;
  if (n.kind === "stage") return 1;
  return 2 + OUTCOME_ORDER.indexOf(n.key);
}

/** A horizontal sankey band through any waypoints: curve between columns, straight across them. */
export function chainPath(segs: LaidLink[]): string {
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
