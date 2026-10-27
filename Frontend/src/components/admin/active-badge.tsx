import { Ban } from "lucide-react"; // inactive icon
import { cn } from "@/lib/utils"; // class merging

export function ActiveBadge({ active, inactiveLabel = "Inactive", className }: { active: boolean; inactiveLabel?: string; className?: string }) { // Active / Inactive (admin spec §3.1)
  return active ? (
    <span className={cn("inline-flex h-6 items-center rounded-md border border-rule px-2 text-xs font-medium text-ink-2", className)}>Active</span>
  ) : (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border border-revoked-line bg-revoked-soft px-2 text-xs font-medium text-revoked", className)}><Ban className="size-3.5" aria-hidden />{inactiveLabel}</span>
  );
}
