import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import { type CampaignSummary } from "@/api/campaigns";

const KEY = "jobtracker.campaign";

interface CampaignState {
  campaigns: CampaignSummary[];
  selected: string; // campaign id or "all"
  /** False until `selected` is final: with no stored choice it becomes the current campaign once
   * GET /campaigns answers. Wait for it before loading per-campaign data, or the page loads
   * "all" first and then again for the campaign. */
  ready: boolean;
  select: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<CampaignState>({ campaigns: [], selected: "all", ready: true, select: () => {}, reload: async () => {} });

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  // "" = not chosen yet: the current campaign once the list is in.
  const [selected, setSelected] = useState<string>(stored() ?? "");

  const reload = useCallback(async () => {
    const r = await api.campaigns();
    setCampaigns(r.campaigns);
    setSelected((cur) => {
      const valid = cur === "all" || r.campaigns.some((c) => c.id === cur);
      return valid ? cur : r.current_id ?? "all";
    });
  }, []);

  useEffect(() => {
    void reload().catch(() => setSelected("all"));
  }, [reload]);

  const select = useCallback((id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode: selection just won't persist */
    }
  }, []);

  const value = useMemo(
    () => ({ campaigns, selected: selected || "all", ready: selected !== "", select, reload }),
    [campaigns, selected, select, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCampaign = () => useContext(Ctx);
