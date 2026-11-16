import { useEditorState, type Editor } from "@tiptap/react";
import { Bold, Code, Heading2, Italic, List, ListChecks, ListOrdered, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EditorToolbar({ editor }: { editor: Editor }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("code"),
    }),
  });
  const run = () => editor.chain().focus();
  const tools: { key: keyof typeof on; icon: typeof Bold; label: string; act: () => void }[] = [
    { key: "h2", icon: Heading2, label: "Heading", act: () => run().toggleHeading({ level: 2 }).run() },
    { key: "bold", icon: Bold, label: "Bold", act: () => run().toggleBold().run() },
    { key: "italic", icon: Italic, label: "Italic", act: () => run().toggleItalic().run() },
    { key: "bullet", icon: List, label: "Bullet list", act: () => run().toggleBulletList().run() },
    { key: "ordered", icon: ListOrdered, label: "Numbered list", act: () => run().toggleOrderedList().run() },
    { key: "task", icon: ListChecks, label: "Checklist", act: () => run().toggleTaskList().run() },
    { key: "quote", icon: Quote, label: "Quote", act: () => run().toggleBlockquote().run() },
    { key: "code", icon: Code, label: "Code", act: () => run().toggleCode().run() },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap gap-0.5 bg-background/90 py-1 backdrop-blur">
      {tools.map(({ key, icon: Icon, label: text, act }) => (
        <Button
          key={key}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={text}
          title={text}
          aria-pressed={on[key]}
          className={cn(on[key] && "bg-muted text-foreground")}
          onMouseDown={(e) => e.preventDefault()} // keep the selection
          onClick={act}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
