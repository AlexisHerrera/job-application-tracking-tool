import type { FlowData } from "@/api";

// The flow chart's graph (the Dashboard's FlowChart lays it out) and the keys it selects, which the
// Applications page filters by.

const STAGE_COL: Record<string, number> = { applied: 0, screening: 1, interviewing: 2, offer: 3 };

type Kind = "stage" | "outcome" | "via";
export type FlowNode = { id: string; key: string; label: string; kind: Kind; col: number };
// `from` / `to` are the real endpoints, so the segments of a skipped-stage flow act as one.
export type FlowLink = { source: string; target: string; value: number; from: string; to: string; chain: string };

// Exits sit next to the stage they left, so one outcome can appear in several columns. Then each
// says which one, or two "Rejected 2 · 13%" read like a duplicate.
const AFTER: Record<string, string> = {
  applied: "after applying",
  screening: "after screening",
  interviewing: "after interviews",
  offer: "after the offer",
};

export function build(data: FlowData) {
  const labels = Object.fromEntries(data.nodes.map((n) => [n.id, n.label]));
  const nodes = new Map<string, FlowNode>();
  const links: FlowLink[] = [];
  const add = (n: FlowNode) => {
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
  const outcomes = [...nodes.values()].filter((n) => n.kind === "outcome");
  for (const n of outcomes) {
    if (outcomes.filter((o) => o.key === n.key).length > 1) n.label = `${n.label} ${AFTER[n.id.split("@")[1]] ?? ""}`.trim();
  }
  return { nodes: [...nodes.values()], links };
}

/** Does an application's path (from `FlowData.paths`) go through a node id or a flow chain? */
export function inFlow(path: string[] | undefined, key: string): boolean {
  if (!path) return false;
  const [a, b] = key.split("->");
  const step = (id: string) => id.split("@") as [string, string | undefined];
  if (b === undefined) {
    const [node, after] = step(a);
    return after === undefined ? path.includes(node) : path.at(-1) === node && path.at(-2) === after;
  }
  const to = step(b)[0];
  return path.some((p, i) => p === a && path[i + 1] === to);
}

/** "Rejected after interviews", or "Applied → Interviews" for a flow. */
export function flowLabel(data: FlowData, key: string): string {
  const labels = new Map(build(data).nodes.map((n) => [n.id, n.label]));
  return key.split("->").map((id) => labels.get(id) ?? id).join(" → ");
}
