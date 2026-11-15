import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ApplicationView } from "@/features/application/ApplicationView/ApplicationView";

export default function ApplicationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link to="/applications"><ArrowLeft /> Applications</Link>
      </Button>
      <ApplicationView id={id} onDeleted={() => navigate("/applications")} />
    </div>
  );
}
