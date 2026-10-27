import { fmtRelative } from "@/lib/format"; // "5 min ago"
import { cn } from "@/lib/utils"; // class merging

interface OnlineDotProps { online: boolean; lastSeenAt?: string | null; showLastSeen?: boolean; now?: number; className?: string; } // inputs

export function OnlineDot({ online, lastSeenAt, showLastSeen = true, now, className }: OnlineDotProps) { // Online / Offline · last seen … (admin spec §3.1)
  return (
    // dot + words (the words carry the meaning)
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", online ? "text-present" : "text-muted-foreground", className)}>
      <span className={cn("size-2 rounded-full", online ? "bg-present" : "bg-muted-foreground/60")} aria-hidden />
      {online ? "Online" : showLastSeen ? `Offline · last seen ${lastSeenAt ? fmtRelative(lastSeenAt, now) : "never"}` : "Offline"}
    </span>
  );
}
