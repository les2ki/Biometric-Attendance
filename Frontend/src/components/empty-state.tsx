import type { LucideIcon } from "lucide-react"; // icon component type
import type { ReactNode } from "react"; // children type
import { cn } from "@/lib/utils"; // class merging

interface EmptyStateProps { // what an empty state shows
  icon: LucideIcon; // small icon, not an illustration
  title: string; // what's empty
  description?: ReactNode; // why it matters / what to do
  action?: ReactNode; // the single next action
  className?: string; // layout overrides
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) { // Hallmark: name it, explain it, offer one action
  return (
    // left-aligned block with a hairline dashed border (not a centred hero)
    <div className={cn("flex flex-col items-start gap-3 rounded-lg border border-dashed border-rule-2/60 bg-surface px-5 py-6", className)}>
      {/* icon in a quiet square */}
      <span className="grid size-9 place-items-center rounded-md border border-rule bg-paper-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      {/* title + explanation */}
      <div className="space-y-1">
        <p className="font-display text-base font-semibold text-ink">{title}</p>
        {description && <div className="max-w-prose text-sm text-muted-foreground">{description}</div>}
      </div>
      {/* the one action */}
      {action}
    </div>
  );
}
