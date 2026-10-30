export type Theme = "light" | "dark";

const STORAGE_KEY = "wagewise-theme";

// Storage can throw in private windows. The theme is a convenience, so failures are ignored.
function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return storedTheme() ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice still applies until the page reloads.
  }
}

/** Restores an explicit choice before first paint; otherwise the system setting applies. */
export function restoreTheme(): void {
  const saved = storedTheme();
  if (saved !== null) document.documentElement.dataset["theme"] = saved;
}
