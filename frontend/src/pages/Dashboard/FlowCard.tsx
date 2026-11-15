import { Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FlowData } from "@/api";
import { Loading } from "@/components/common";
import { FlowChart } from "./FlowChart/FlowChart";

/** "Where applications went". A node or a flow opens the applications that went through it. */
export function FlowCard({ flow }: { flow: FlowData | undefined }) {
  const navigate = useNavigate();
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Waypoints className="size-4 text-muted-foreground" /> Where applications went</CardTitle>
      </CardHeader>
      <CardContent>
        {flow ? (
          <FlowChart data={flow} onSelect={(key) => navigate(`/applications?${new URLSearchParams({ view: "all", flow: key })}`)} />
        ) : (
          <Loading error={null} loading rows={1} />
        )}
      </CardContent>
    </Card>
  );
}
