import { toast } from "sonner";
import { errorText } from "@/lib/errors";
import { PageHeader } from "@/components/common";
import { useCampaign } from "@/lib/campaign";
import { useRefresh } from "@/lib/refresh";
import { CampaignCard } from "./CampaignCard";
import { NewCampaignForm } from "./NewCampaignForm";

export default function Campaigns() {
  const { campaigns, reload } = useCampaign();
  const { bump } = useRefresh();

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reload();
      bump();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Campaigns" description="A campaign is one job-search period. Applications join it by their applied date." />
      <div className="grid gap-4">
        {campaigns.map((c) => <CampaignCard key={c.id} c={c} run={run} />)}
        <NewCampaignForm run={run} />
      </div>
    </div>
  );
}
