import type { api } from "@/api/client";

export type Patch = Parameters<typeof api.updateApplication>[1];
