import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { initAuth, type AuthState } from "./auth";

// Renders the app once sign-in is settled (prod), or right away (local, no login).
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    initAuth()
      .then((s) => live && setState(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <div className="grid min-h-svh place-items-center bg-background p-6">
        <div className="max-w-sm space-y-3 text-center">
          <p className="font-medium">Couldn't sign you in</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" onClick={() => window.location.assign("/")}>Try again</Button>
        </div>
      </div>
    );
  }
  if (state?.status !== "ready") {
    return <div className="min-h-svh bg-background" aria-busy="true" />;
  }
  return children;
}
