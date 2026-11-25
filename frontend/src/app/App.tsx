import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ShellStatusProvider } from "@/features/shell/shellStatus";
import { AppRoutes } from "./AppRoutes";
import { MobileHeader } from "./MobileHeader";
import { Sidebar } from "./Sidebar";

const EditorDialog = lazy(() => import("@/features/notes/EditorDialog").then((module) => ({ default: module.EditorDialog })));

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [params] = useSearchParams();

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
          {(params.get("interview") || params.get("note")) && (
            <Suspense fallback={<p role="status" className="fixed bottom-4 right-4 rounded-md border bg-popover p-3 text-sm">Loading editor…</p>}>
              <EditorDialog />
            </Suspense>
          )}
        </div>
      </div>
    </ShellStatusProvider>
  );
}
