import type { Interview } from "@/api/interviews";
import { talkWith } from "@/lib/interviews";

/** The company, or "General talk · silver.dev" when there's none. */
export const who = (i: Interview) => (i.general ? `General talk · ${talkWith(i) ?? ""}` : i.company ?? "?");
