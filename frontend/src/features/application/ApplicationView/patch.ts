import type { api } from "@/api";

export type Patch = Parameters<typeof api.updateApplication>[1];
