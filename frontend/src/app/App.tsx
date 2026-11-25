import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EditorDialog } from "@/features/notes/EditorDialog";
import { ShellStatusProvider } from "@/features/shell/shellStatus";
import { AppRoutes } from "./AppRoutes";
import { MobileHeader } from "./MobileHeader";
import { Sidebar } from "./Sidebar";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <ShellStatusProvider>
      <div className="flex min-h-svh bg-background">
        <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
          <Sidebar />
        </aside>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-64 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
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
    </ShellStatusProvider>
  );
}
