import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A text box that updates its filter 300 ms after the last keystroke. */
export function TextFilter({ value, onChange, placeholder, className, icon, inputMode, title }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; icon?: boolean; inputMode?: "numeric"; title?: string }) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  // Follow the URL only when something else changed it ("Clear filters"), never while typing.
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === sent.current) return;
    const t = setTimeout(() => {
      sent.current = text;
      onChange(text);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className={cn("relative", className)}>
      {icon && <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        inputMode={inputMode}
        title={title}
        className={cn("h-8", icon && "pl-8", value && "border-primary")}
      />
    </div>
  );
}
