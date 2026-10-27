import type { ReactNode } from "react"; // children types
import { cn } from "@/lib/utils"; // class merging

interface StatCardProps { // one headline number
  label: string; // what is counted
  value: ReactNode; // the number (display face, tabular)
  hint?: ReactNode; // small line under the number
  tone?: "default" | "present" | "muted"; // colour of the number
  size?: "default" | "projector"; // projector = readable from the back of a lecture hall
  className?: string; // layout overrides
}

export function StatCard({ label, value, hint, tone = "default", size = "default", className }: StatCardProps) { // label above a big number
  return (
    // hairline-bordered cell (no shadow, no card-in-card)
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-rule bg-surface px-4 py-3", size === "projector" && "gap-1.5 px-5 py-4", className)}>
      {/* label in the data face, uppercase, tracked */}
      <p className="font-mono text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      {/* the number */}
      <p
        className={cn(
          "tabular font-display leading-none font-semibold tracking-tight",
          size === "projector" ? "text-4xl md:text-5xl" : "text-3xl", // bigger numbers for the projector
          tone === "present" ? "text-present" : tone === "muted" ? "text-ink-2" : "text-ink", // number colour by tone
        )}
      >
        {value}
      </p>
      {/* hint line */}
      {hint && <p className={cn("text-muted-foreground", size === "projector" ? "text-sm md:text-base" : "text-xs")}>{hint}</p>}
    </div>
  );
}
