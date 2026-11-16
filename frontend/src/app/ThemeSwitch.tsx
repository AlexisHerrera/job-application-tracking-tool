import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme, type Theme } from "@/lib/theme";

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v as Theme)} aria-label="Theme">
      <ToggleGroupItem value="light" aria-label="Light"><Sun /></ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark"><Moon /></ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System"><Monitor /></ToggleGroupItem>
    </ToggleGroup>
  );
}
