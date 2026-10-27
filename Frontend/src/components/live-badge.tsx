import { cn } from "@/lib/utils"; // class merging

export function LiveBadge({ className, label = "Live" }: { className?: string; label?: string }) { // pulsing green "Live" pill
  return (
    // pill with a pulsing dot; the word "Live" carries the meaning for colour-blind users and reduced motion
    <span className={cn("inline-flex h-6 items-center gap-2 rounded-md border border-present-line bg-present-soft px-2 text-xs font-semibold tracking-wide text-present uppercase", className)}>
      {/* the dot: a static dot plus an expanding ring (animation stops under reduced motion) */}
      <span className="relative flex size-2" aria-hidden>
        <span className="live-ping absolute inline-flex size-full rounded-full bg-present" />
        <span className="relative inline-flex size-2 rounded-full bg-present" />
      </span>
      {label}
    </span>
  );
}
