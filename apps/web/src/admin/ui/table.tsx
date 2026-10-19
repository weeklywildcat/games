import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/utils.ts";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} className={cn("[&_tr]:border-b", p.className)} />;
export const TableBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} className={cn("[&_tr:last-child]:border-0", p.className)} />;
export const TableRow = (p: HTMLAttributes<HTMLTableRowElement>) => <tr {...p} className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", p.className)} />;
export const TableHead = (p: ThHTMLAttributes<HTMLTableCellElement>) => <th {...p} className={cn("h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground", p.className)} />;
export const TableCell = (p: TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} className={cn("px-3 py-2.5 align-middle", p.className)} />;
