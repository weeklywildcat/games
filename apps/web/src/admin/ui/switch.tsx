import { Switch as S } from "radix-ui";
import { cn } from "../lib/utils.ts";

export function Switch({ checked, onCheckedChange, id, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; disabled?: boolean; label?: string }) {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <S.Thumb className={cn("pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
    </S.Root>
  );
}
