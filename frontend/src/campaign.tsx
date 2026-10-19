import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type CampaignSummary } from "./api";

const KEY = "jobtracker.campaign";

interface CampaignState {
  campaigns: CampaignSummary[];
  selected: string; // campaign id or "all"
  select: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<CampaignState>({ campaigns: [], selected: "all", select: () => {}, reload: async () => {} });

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
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

  const select = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode: selection just won't persist */
    }
  };

  return <Ctx.Provider value={{ campaigns, selected: selected || "all", select, reload }}>{children}</Ctx.Provider>;
}

export const useCampaign = () => useContext(Ctx);

export function CampaignPicker() {
  const { campaigns, selected, select } = useCampaign();
  if (campaigns.length === 0) return null;
  return (
    <select className="campaign-picker" value={selected} onChange={(e) => select(e.target.value)} aria-label="Campaign">
      {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.ongoing ? "" : " (ended)"}</option>)}
      <option value="all">All campaigns</option>
    </select>
  );
}
