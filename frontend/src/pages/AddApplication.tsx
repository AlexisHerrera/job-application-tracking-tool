import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ApplicationForm } from "../ApplicationForm";
import { Card } from "../components";
import { PasteAssistant } from "../PasteAssistant";

export default function AddApplication() {
  const navigate = useNavigate();
  return (
    <div className="grid">
      <Card title="Paste anything">
        <PasteAssistant onApplied={() => navigate("/applications")} />
      </Card>
      <Card title="Or fill the form">
        <ApplicationForm
          submitLabel="Add application"
          onSubmit={async (data) => {
            const created = await api.createApplication(data);
            navigate(`/applications/${created.id}`);
          }}
        />
      </Card>
    </div>
  );
}
