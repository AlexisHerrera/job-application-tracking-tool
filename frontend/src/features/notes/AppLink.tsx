import { Link } from "react-router-dom";

export function AppLink({ appId, company, role }: { appId: string | null; company: string | null; role: string | null }) {
  const text = [company, role].filter(Boolean).join(" · ");
  return appId ? <Link to={`/applications/${appId}`} className="truncate hover:text-foreground hover:underline">{text}</Link> : <span>{text}</span>;
}
