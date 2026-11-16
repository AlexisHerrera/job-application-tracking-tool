import { ChevronDown } from "lucide-react";
import type { Facet } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function TechPicker({ selected, options, onChange }: { selected: string[]; options: Facet; onChange: (techs: string[]) => void }) {
  const isOn = (t: string) => selected.some((x) => x.toLowerCase() === t.toLowerCase());
  const missing: Facet = selected.filter((t) => !options.some(([v]) => v.toLowerCase() === t.toLowerCase())).map((t) => [t, 0]);
  const toggle = (t: string) => onChange(isOn(t) ? selected.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...selected, t]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("max-w-72 font-normal", selected.length > 0 && "border-primary")}>
          <span className="truncate">{selected.length ? selected.join(" + ") : "Any technology"}</span> <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="TypeScript, Python…" />
          <CommandList>
            <CommandEmpty>No posting lists that one.</CommandEmpty>
            <CommandGroup heading={selected.length > 1 ? "Postings that ask for all of these" : "Postings that ask for"}>
              {[...missing, ...options].map(([t, n]) => (
                <CommandItem key={t} value={t} onSelect={() => toggle(t)} data-checked={isOn(t)}>
                  <span className="truncate">{t}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{n}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
