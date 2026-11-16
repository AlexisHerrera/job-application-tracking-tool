import { useRef, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ghostField } from "./ghostField";

export function EditableText({
  value, onSave, display, placeholder = "Empty", multiline = false, clamp = false, required = false, type = "text", className,
}: {
  value: string;
  onSave: (v: string | null) => Promise<void>;
  display?: ReactNode;
  placeholder?: string;
  multiline?: boolean;
  clamp?: boolean;
  required?: boolean;
  type?: "text" | "number" | "date" | "url";
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const done = useRef(false);

  const start = () => {
    setDraft(value);
    done.current = false;
    setEditing(true);
  };
  const commit = async () => {
    if (done.current) return; // Enter commits, then the unmount blur must not commit again
    done.current = true;
    setEditing(false);
    const v = draft.trim();
    if (v === value.trim() || (required && !v)) return;
    await onSave(v || null);
  };

  if (!editing) {
    const shown = display ?? (value ? value : null);
    return (
      <button type="button" onClick={start} className={cn(ghostField, multiline && "items-start whitespace-pre-wrap", className)}>
        {shown ? (
          <span className={cn("min-w-0", clamp && "line-clamp-4")}>{shown}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>
    );
  }
  const common = {
    autoFocus: true,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // keep the sheet open
        done.current = true;
        setEditing(false);
      } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void commit();
      }
    },
  };
  return multiline ? (
    <div className="space-y-1">
      <Textarea rows={5} {...common} />
      <p className="text-xs text-muted-foreground">⌘/Ctrl + Enter to save · Esc to cancel</p>
    </div>
  ) : (
    <Input type={type} min={type === "number" ? 1 : undefined} {...common} />
  );
}
