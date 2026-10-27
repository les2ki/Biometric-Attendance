import type { Role } from "@/lib/types"; // admin | lecturer
import { cn } from "@/lib/utils"; // class merging

export function RoleBadge({ role, className }: { role: Role; className?: string }) { // small uppercase role tag
  return (
    // mono label voice; admin gets the cobalt outline, lecturer stays neutral
    <span className={cn("inline-flex h-5 items-center rounded border px-1.5 font-mono text-[0.65rem] font-medium tracking-[0.08em] uppercase", role === "admin" ? "border-cobalt/40 text-cobalt" : "border-rule-2/60 text-muted-foreground", className)}>
      {role}
    </span>
  );
}
