"use client"; // ticking duration

import Link from "next/link"; // the whole card is a link
import { Cpu, MapPin } from "lucide-react"; // meta icons
import { Progress } from "@/components/ui/progress"; // present / roster bar
import { LiveBadge } from "@/components/live-badge"; // pulsing "Live"
import { useNow } from "@/hooks/use-now"; // for the running duration
import { fmtDuration, fmtTime, percent } from "@/lib/format"; // formatting
import type { SessionOut } from "@/lib/types"; // session shape

export function SessionCard({ session }: { session: SessionOut }) { // one open session on the overview (spec §6.3 A)
  const now = useNow(30_000); // duration refreshes every 30 s
  const { present, roster } = session.counts; // headline numbers
  const pct = percent(present, roster); // 0–100

  return (
    // card link: hairline border, cobalt border on hover/focus (the one signal), no lift
    <Link
      href={`/lecturer/sessions/${session.id}`}
      className="group flex flex-col gap-4 rounded-lg border border-rule bg-surface p-4 outline-none transition-colors duration-(--dur-short) ease-out hover:border-cobalt/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {/* course + live badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight font-bold text-ink">{session.course_code}</p>
          <p className="truncate text-sm text-ink-2">{session.course_name}</p>
        </div>
        <LiveBadge />
      </div>
      {/* where + which terminal + since when */}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p className="flex items-center gap-1.5 truncate"><MapPin className="size-3.5 shrink-0" aria-hidden />{session.venue}</p>
        <p className="flex items-center gap-1.5 truncate"><Cpu className="size-3.5 shrink-0" aria-hidden />{session.device_name}</p>
        <p className="tabular font-mono text-xs">Opened {fmtTime(session.opened_at).slice(0, 5)} · {fmtDuration(session.opened_at, null, now)}</p>
      </div>
      {/* present / roster */}
      <div className="space-y-1.5">
        <Progress value={pct} aria-label={`${present} of ${roster} present`} className="h-1.5 bg-paper-3 [&>[data-slot=progress-indicator]]:bg-present" />
        <p className="tabular text-sm text-ink-2"><span className="font-semibold text-ink">{present}</span> / {roster} present</p>
      </div>
    </Link>
  );
}
