import { Fingerprint, ScanFace, UserCheck } from "lucide-react"; // one icon per method
import type { Method } from "@/lib/types"; // fingerprint | face | manual
import { cn } from "@/lib/utils"; // class merging

const METHODS: Record<Method, { label: string; Icon: typeof Fingerprint }> = { // label + icon per method
  fingerprint: { label: "Fingerprint", Icon: Fingerprint }, // terminal scan
  manual: { label: "Manual", Icon: UserCheck }, // lecturer-confirmed
  face: { label: "Face", Icon: ScanFace }, // future face path
};

export function MethodBadge({ method, className }: { method: Method | null; className?: string }) { // how a record was captured
  if (!method) return null; // absent students have no method
  const { label, Icon } = METHODS[method]; // pick label + icon
  return (
    // quiet outlined chip: icon + text
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border border-rule px-2 text-xs font-medium whitespace-nowrap text-ink-2", className)}>
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {label}
    </span>
  );
}
