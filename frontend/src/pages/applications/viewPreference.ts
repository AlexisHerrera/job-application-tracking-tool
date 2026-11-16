const VIEW_KEY = "jobtracker.view";

export function storedView(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

export function saveView(v: string) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* private mode */
  }
}
