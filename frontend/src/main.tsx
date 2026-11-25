import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ApiProgress } from "@/components/ApiProgress";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "@/app/App";
import { AuthGate } from "@/app/AuthGate";
import { CampaignProvider } from "@/lib/campaign";
import { RefreshProvider } from "@/lib/refresh";
import { ThemeProvider } from "@/lib/theme";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <AuthGate>
          <BrowserRouter>
            <RefreshProvider>
              <CampaignProvider>
                <App />
                <ApiProgress />
                <Toaster position="bottom-right" richColors closeButton />
              </CampaignProvider>
            </RefreshProvider>
          </BrowserRouter>
        </AuthGate>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
