import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PasteAssistant } from "@/PasteAssistant";

export function PasteMoreInfo({ applicationId, onApplied }: { applicationId: string; onApplied: () => void }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="group"><Sparkles /> Paste more info <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <PasteAssistant applicationId={applicationId} onApplied={onApplied} />
      </CollapsibleContent>
    </Collapsible>
  );
}
