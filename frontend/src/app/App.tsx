import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/api/client";
import { EditorDialog } from "@/features/notes/EditorDialog";
import { useAsync } from "@/lib/useAsync";
import { AppRoutes } from "./AppRoutes";
import { MobileHeader } from "./MobileHeader";
import { Sidebar } from "./Sidebar";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = useAsync(api.dashboard).data;

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <Sidebar inbox={(counts?.unassigned ?? 0) + (counts?.unassigned_interviews ?? 0)} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar inbox={(counts?.unassigned ?? 0) + (counts?.unassigned_interviews ?? 0)} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onOpenMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-8">
          <AppRoutes />
        </main>
        <EditorDialog />
      </div>
    </div>
  );
}
