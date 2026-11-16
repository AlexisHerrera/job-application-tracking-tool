import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shown until the fields are saved once: the AI still reads the old free text. */
export function OldCriteriaBanner() {
  return (
    <Alert>
      <Info />
      <AlertTitle>The AI still reads your old criteria text</AlertTitle>
      <AlertDescription>
        The fields start from the defaults, and your saved text is in “Other notes” at the bottom. Trim the notes down to what the fields don't cover, then save: from then on the AI reads what the fields render to.
      </AlertDescription>
    </Alert>
  );
}
