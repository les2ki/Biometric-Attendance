import { CircleCheck, CircleDashed, CircleSlash } from "lucide-react"; // state icons (never colour alone)
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"; // revoke reason popup
import type { RosterStatus } from "@/lib/types"; // present | absent | revoked
import { cn } from "@/lib/utils"; // class merging

const STYLES: Record<RosterStatus, { label: string; className: string; Icon: typeof CircleCheck }> = { // one look per state
  present: { label: "Present", className: "border-present-line bg-present-soft text-present", Icon: CircleCheck }, // emerald
  absent: { label: "Absent", className: "border-rule-2/50 bg-transparent text-muted-foreground", Icon: CircleDashed }, // muted outline
  revoked: { label: "Revoked", className: "border-revoked-line bg-revoked-soft text-revoked", Icon: CircleSlash }, // amber
};

interface StatusBadgeProps { status: RosterStatus; reason?: string | null; className?: string; } // badge inputs

export function StatusBadge({ status, reason, className }: StatusBadgeProps) { // Present / Absent / Revoked pill
  const { label, className: tone, Icon } = STYLES[status]; // pick the look
  const badge = ( // the visual badge
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap", tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
  if (status !== "revoked" || !reason) return badge; // only revoked rows carry a reason
  return (
    // revoked: reason in a tooltip (focusable so keyboard users can read it too)
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`Revoked: ${reason}`}>
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">Revoked: {reason}</TooltipContent>
    </Tooltip>
  );
}
