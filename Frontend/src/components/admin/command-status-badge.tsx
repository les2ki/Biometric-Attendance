import { Ban, CircleCheck, CircleX, Clock, Hourglass } from "lucide-react"; // state icons
import type { CommandStatus } from "@/lib/types"; // pending … expired
import { cn } from "@/lib/utils"; // class merging

const PILL = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap"; // shared shape

export function CommandStatusBadge({ status, className }: { status: CommandStatus; className?: string }) { // admin spec §3.1 wording
  if (status === "in_progress") { // blue with a pulsing dot
    return (
      <span className={cn(PILL, "border-cobalt/40 bg-cobalt-soft text-cobalt", className)}>
        <span className="relative flex size-2" aria-hidden>
          <span className="live-ping absolute inline-flex size-full rounded-full bg-cobalt" />
          <span className="relative inline-flex size-2 rounded-full bg-cobalt" />
        </span>
        On terminal now
      </span>
    );
  }
  const map: Record<Exclude<CommandStatus, "in_progress">, { label: string; tone: string; Icon: typeof Clock }> = { // the rest
    pending: { label: "Waiting for terminal", tone: "border-rule-2/50 text-ink-2", Icon: Clock }, // slate
    done: { label: "Done", tone: "border-present-line bg-present-soft text-present", Icon: CircleCheck }, // emerald
    failed: { label: "Failed", tone: "border-danger/40 bg-danger-soft text-danger", Icon: CircleX }, // red
    expired: { label: "Expired", tone: "border-revoked-line bg-revoked-soft text-revoked", Icon: Hourglass }, // amber
    cancelled: { label: "Cancelled", tone: "border-rule-2/50 text-muted-foreground", Icon: Ban }, // slate outline
  };
  const s = map[status]; // pick
  return <span className={cn(PILL, s.tone, className)}><s.Icon className="size-3.5" aria-hidden />{s.label}</span>; // icon + label
}
