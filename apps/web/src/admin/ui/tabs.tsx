import { Tabs as T } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

export function Tabs({ value, onValueChange, tabs, children }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: ReactNode }[]; children?: ReactNode }) {
  return (
    <T.Root value={value} onValueChange={onValueChange}>
      <T.List className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer")}
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}
