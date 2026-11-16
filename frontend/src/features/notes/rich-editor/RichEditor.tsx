import { useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorToolbar } from "./EditorToolbar";

/** Markdown in, Markdown out. Shortcuts work too: "## ", "- ", "[ ] ", **bold**. */
export function RichEditor({ initial, onChange, placeholder, autoFocus = false }: {
  initial: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder }),
    ],
    content: initial,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    editorProps: { attributes: { class: "notes-doc", "aria-label": "Notes", "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
  });
  return (
    <div className="flex min-h-0 flex-col">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} className="min-h-0 flex-1" />
    </div>
  );
}
