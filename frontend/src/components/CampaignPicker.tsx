import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaign } from "@/lib/campaign";

export function CampaignPicker({ className }: { className?: string }) {
  const { campaigns, selected, select } = useCampaign();
  if (campaigns.length === 0) return null;
  return (
    <Select value={selected} onValueChange={select}>
      <SelectTrigger size="sm" className={className} aria-label="Campaign">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {campaigns.map((c) => (
          <SelectItem key={c.id} value={c.id}>{c.name}{c.ongoing ? "" : " (ended)"}</SelectItem>
        ))}
        <SelectItem value="all">All campaigns</SelectItem>
      </SelectContent>
    </Select>
  );
}
