import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ApplicationForm } from "../ApplicationForm";
import { Card } from "../components";

const SAMPLE = `company,role,applied_at,stage,job_url,company_domain,source_channel,seniority,stack,location,notes
Northwind,Senior Backend Engineer,2026-08-01,rejected,https://jobs.lever.co/northwind/123,northwind.com,direct,senior,python;aws,Remote,`;

export default function AddApplication() {
  const navigate = useNavigate();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importCsv() {
    setError(null);
    setResult(null);
    try {
      const r = await api.importCsv(csv);
      setResult(`Imported ${r.created} application(s); ${r.matched_from_inbox} inbox email(s) matched to them.`);
      setCsv("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="grid">
      <Card title="Add an application">
        <ApplicationForm
          submitLabel="Add application"
          onSubmit={async (data) => {
            const created = await api.createApplication(data);
            navigate(`/applications/${created.id}`);
          }}
        />
      </Card>
      <Card title="Bulk import (CSV)">
        <p className="muted small">
          Required columns: <code>company</code>, <code>role</code>. Optional: applied_at (YYYY-MM-DD or DD/MM/YYYY),
          stage, job_url, company_domain, source_channel, seniority, stack (separated by ;), location, notes.
        </p>
        <textarea rows={8} value={csv} placeholder={SAMPLE} onChange={(e) => setCsv(e.target.value)} />
        <div className="actions">
          <button onClick={importCsv} disabled={!csv.trim()}>Import</button>
          <button className="secondary" onClick={() => setCsv(SAMPLE)}>Use example</button>
        </div>
        {result && <p className="ok">{result}</p>}
        {error && <p className="error">{error}</p>}
      </Card>
    </div>
  );
}
