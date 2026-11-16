import { ClipboardPaste, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/api/client";
import { ApplicationForm } from "@/features/application/application-form/ApplicationForm";
import { PageHeader } from "@/components/common";
import { useRefresh } from "@/lib/refresh";
import { PasteAssistant } from "@/features/application/paste-assistant/PasteAssistant";

export default function AddApplication() {
  const navigate = useNavigate();
  const { bump } = useRefresh();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New application" description="Paste whatever you have and let the AI fill it in, or use the form." />
      <Tabs defaultValue="paste">
        <TabsList>
          <TabsTrigger value="paste"><ClipboardPaste /> Paste anything</TabsTrigger>
          <TabsTrigger value="form"><FileText /> Form</TabsTrigger>
        </TabsList>
        <Card className="mt-3">
          <CardContent>
            <TabsContent value="paste">
              <PasteAssistant onApplied={() => { bump(); navigate("/applications"); }} />
            </TabsContent>
            <TabsContent value="form">
              <ApplicationForm
                submitLabel="Add application"
                onSubmit={async (data) => {
                  const created = await api.createApplication(data);
                  bump();
                  navigate(`/applications?open=${created.id}`);
                }}
              />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
