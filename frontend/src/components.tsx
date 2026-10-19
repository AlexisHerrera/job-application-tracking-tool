import type { ReactNode } from "react";
import { label, type Status } from "./api";

export function StatusBadge({ status }: { status: Status | string }) {
  return <span className={`badge badge-${status}`}>{label(status)}</span>;
}

export function Loading({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="error">Error: {error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  return null;
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
