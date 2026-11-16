import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ApplicationView } from "@/features/application/application-view/ApplicationView";

export function ApplicationSheet({ openId, onClose }: { openId: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!openId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">
        <SheetTitle className="sr-only">Application</SheetTitle>
        {openId && <ApplicationView key={openId} id={openId} inSheet onDeleted={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
