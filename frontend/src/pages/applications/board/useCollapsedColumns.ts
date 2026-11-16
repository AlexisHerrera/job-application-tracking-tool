import { useState } from "react";
import type { Status } from "@/api";

const COLLAPSED_KEY = "jobtracker.board.collapsed";

function storedCollapsed(): Set<Status> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** The board's collapsed columns, kept in localStorage. */
export function useCollapsedColumns() {
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  const toggle = (s: Status) => {
    const next = new Set(collapsed);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode: layout just won't persist */
    }
  };

  return { collapsed, toggle };
}
