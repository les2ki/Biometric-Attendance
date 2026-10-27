import { ShieldCheck, ShieldOff } from "lucide-react"; // icons
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"; // consent date
import { fmtDateTime } from "@/lib/format"; // SAST date
import { cn } from "@/lib/utils"; // class merging

interface ConsentBadgeProps { consent: boolean; consentAt?: string | null; className?: string; } // inputs

export function ConsentBadge({ consent, consentAt, className }: ConsentBadgeProps) { // "Consent given" / "No consent" (admin spec §3.1)
  const badge = consent ? ( // the pill
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border border-present-line bg-present-soft px-2 text-xs font-medium whitespace-nowrap text-present", className)}>
      <ShieldCheck className="size-3.5" aria-hidden />Consent given
    </span>
  ) : (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border border-rule-2/50 px-2 text-xs font-medium whitespace-nowrap text-muted-foreground", className)}>
      <ShieldOff className="size-3.5" aria-hidden />No consent
    </span>
  );
  if (!consent || !consentAt) return badge; // nothing to add
  return (
    // the date in a tooltip (focusable for keyboard users)
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`Consent given ${fmtDateTime(consentAt)}`}>{badge}</button>
      </TooltipTrigger>
      <TooltipContent>Recorded {fmtDateTime(consentAt)}</TooltipContent>
    </Tooltip>
  );
}
