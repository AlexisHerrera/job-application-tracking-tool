import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard, with a check mark for a moment after. */
export function CopyButton({ text, label = "Copy", showLabel = false }: { text: string; label?: string; showLabel?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy: the browser blocked the clipboard");
    }
  }

  const Icon = copied ? Check : Copy;
  return showLabel ? (
    <Button type="button" size="sm" variant="outline" disabled={!text} onClick={copy}>
      <Icon />
      {copied ? "Copied" : label}
    </Button>
  ) : (
    <Button type="button" size="icon-sm" variant="ghost" disabled={!text} onClick={copy} title={label} aria-label={label}>
      <Icon />
    </Button>
  );
}
