"use client"; // live, polling page (spec U2/U6)

import { useMemo, useState } from "react"; // React
import Link from "next/link"; // breadcrumb
import { notFound, useParams, useSearchParams } from "next/navigation"; // route id + ?tab=&q=
import { ChevronRight, CircleStop, Cpu, MapPin, RotateCw, UserPlus, UsersRound } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Skeleton } from "@/components/ui/skeleton"; // loading header
import { EmptyState } from "@/components/empty-state"; // empty roster / not found
import { LiveBadge } from "@/components/live-badge"; // pulsing "Live"
import { StatCard } from "@/components/stat-card"; // headline numbers
import { CloseSessionDialog } from "@/components/lecturer/close-session-dialog"; // close confirm
import { ExportButton } from "@/components/lecturer/export-button"; // CSV
import { ManualMarkDialog, type MarkTarget } from "@/components/lecturer/manual-mark-dialog"; // mark / reinstate
import { RevokeDialog } from "@/components/lecturer/revoke-dialog"; // revoke
import { ROSTER_TABS, RosterTable, type RosterTab } from "@/components/lecturer/roster-table"; // the class list
import { useRoster, useSession } from "@/hooks/use-lecturer"; // data
import { useNow } from "@/hooks/use-now"; // "Updated 2 s ago" ticker
import { ApiError } from "@/lib/api"; // 404 detection
import { errorMessage } from "@/lib/errors"; // friendly text
import { fmtDateTime, fmtDuration, fmtPercent, fmtSecondsAgo, fmtTime, percent } from "@/lib/format"; // formatting
import type { RosterEntry } from "@/lib/types"; // row type

export default function LiveSessionPage() { // /lecturer/sessions/[id] (WP6)
  const { id } = useParams<{ id: string }>(); // route parameter (string)
  const sessionId = Number(id); // numeric id
  if (!Number.isInteger(sessionId) || sessionId <= 0) notFound(); // "/lecturer/sessions/abc" → 404 page
  return <LiveSession sessionId={sessionId} />; // the real page
}

function LiveSession({ sessionId }: { sessionId: number }) { // split out so hooks always run in the same order
  const searchParams = useSearchParams(); // ?tab=…&q=…
  const tabParam = searchParams.get("tab") as RosterTab | null; // requested tab
  const tab: RosterTab = tabParam && ROSTER_TABS.includes(tabParam) ? tabParam : "all"; // validated tab
  const query = searchParams.get("q") ?? ""; // search text

  const sessionQ = useSession(sessionId); // header (cached from the overview when coming from there)
  const roster = useRoster(sessionId, sessionQ.data?.is_open); // live roster; polls while open
  const session = roster.data?.session ?? sessionQ.data; // the roster's copy has the freshest counts
  const entries = roster.data?.entries; // class list
  const now = useNow(1000); // ticks every second for "Updated n s ago"

  const [markTarget, setMarkTarget] = useState<MarkTarget | null | "blank">(null); // null = closed, "blank" = walk-in
  const [revokeTarget, setRevokeTarget] = useState<RosterEntry | null>(null); // row being revoked
  const [closeOpen, setCloseOpen] = useState(false); // close dialog

  const setUrlParam = (key: "tab" | "q", value: string) => { // keep tab/search in the URL so a refresh keeps them
    const params = new URLSearchParams(searchParams.toString()); // copy current params
    if (!value || (key === "tab" && value === "all")) params.delete(key); // defaults stay out of the URL
    else params.set(key, value); // set the value
    const qs = params.toString(); // encoded
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname); // Next.js syncs useSearchParams with the native history API (no server round-trip per keystroke)
  };

  const stats = useMemo(() => { // numbers for the stat cards
    const list = entries ?? []; // rows
    const present = list.filter((e) => e.status === "present"); // counted as present
    const byMethod = { fingerprint: 0, manual: 0, face: 0 }; // tally by capture method
    for (const e of present) if (e.method) byMethod[e.method] += 1; // count
    return { present: present.length, absent: list.length - present.length, roster: list.length, byMethod }; // derived numbers
  }, [entries]); // recompute on each poll

  const notFoundError = (sessionQ.error instanceof ApiError && sessionQ.error.status === 404) || (roster.error instanceof ApiError && roster.error.status === 404); // not mine / doesn't exist
  if (notFoundError) { // D5: other lecturers' sessions look like missing ones
    return <EmptyState icon={UsersRound} title="Session not found" description="It may belong to a course you don’t teach, or the link is wrong." action={<Button asChild variant="outline"><Link href="/lecturer">Back to Sessions</Link></Button>} />; // dead end with a way back
  }

  const counts = session ? { roster: stats.roster || session.counts.roster, present: entries ? stats.present : session.counts.present, absent: entries ? stats.absent : session.counts.absent } : { roster: 0, present: 0, absent: 0 }; // prefer live entries
  const methodLine = [stats.byMethod.fingerprint && `${stats.byMethod.fingerprint} fingerprint`, stats.byMethod.manual && `${stats.byMethod.manual} manual`, stats.byMethod.face && `${stats.byMethod.face} face`].filter(Boolean).join(" · ") || "—"; // "18 fingerprint · 2 manual"

  return (
    <div className="space-y-6">
      {/* header block */}
      <header className="space-y-4 border-b border-rule pb-5">
        {/* breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/lecturer" className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">Sessions</Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span aria-current="page" className="text-ink-2">{session?.course_code ?? "…"}</span>
        </nav>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          {/* title + meta */}
          <div className="min-w-0 space-y-2">
            {session ? (
              <h1 className="text-2xl leading-tight font-semibold md:text-3xl">{session.course_code} — {session.course_name}</h1>
            ) : <Skeleton className="h-9 w-80" />}
            {session && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" aria-hidden />{session.venue}</span>
                <span className="inline-flex items-center gap-1.5"><Cpu className="size-3.5" aria-hidden />{session.device_name}</span>
                <span>Opened {fmtDateTime(session.opened_at)}</span>
                <span>{session.lecturer_name}</span>
              </p>
            )}
            {/* live / closed status */}
            {session && (
              <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
                {session.is_open ? (
                  <>
                    <LiveBadge />
                    <span className="tabular text-muted-foreground" aria-live="off">{roster.dataUpdatedAt ? `Updated ${fmtSecondsAgo(roster.dataUpdatedAt, now)}` : "Connecting…"}</span>
                    {roster.isError && <span className="text-danger">Live updates paused — {errorMessage(roster.error)}</span>}
                  </>
                ) : (
                  <>
                    <span className="inline-flex h-6 items-center rounded-md border border-rule px-2 text-xs font-medium text-muted-foreground">Closed at {session.closed_at ? fmtTime(session.closed_at).slice(0, 5) : "—"}</span>
                    <span className="text-muted-foreground">Ran {fmtDuration(session.opened_at, session.closed_at, now)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* actions (wrap on mobile) */}
          {session && (
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => setMarkTarget("blank")}><UserPlus className="size-4" aria-hidden />Mark present</Button>
              <ExportButton sessionId={sessionId} />
              {session.is_open && (
                <Button size="lg" variant="outline" className="border-danger/50 text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setCloseOpen(true)}>
                  <CircleStop className="size-4" aria-hidden />Close session
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* stat cards: 2×2 on phones, 4 across on desktop; sized for a projector */}
      <section aria-label="Attendance summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard size="projector" label="Present" tone="present" value={counts.present} hint={`of ${counts.roster} on the class list`} />
        <StatCard size="projector" label="Absent" tone="muted" value={counts.absent} hint={counts.absent === 1 ? "student not recorded" : "students not recorded"} />
        <StatCard size="projector" label="Attendance" value={fmtPercent(percent(counts.present, counts.roster))} hint="present ÷ class list" />
        <StatCard size="projector" label="By method" value={<span className="block text-xl leading-snug md:text-2xl">{methodLine}</span>} hint="how present students were recorded" />
      </section>

      {/* roster */}
      <section aria-labelledby="roster-heading" className="space-y-3">
        <h2 id="roster-heading" className="text-lg font-semibold">Class list</h2>
        {/* error with retry (only when nothing has loaded yet) */}
        {roster.isError && !entries && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
            {errorMessage(roster.error)}
            <Button variant="outline" size="sm" onClick={() => roster.refetch()}><RotateCw className="size-4" aria-hidden />Retry</Button>
          </div>
        )}
        {/* empty class list */}
        {entries && entries.length === 0 && (
          <EmptyState icon={UsersRound} title="No students on this course’s class list" description="Ask an administrator to add them." />
        )}
        {/* the table */}
        {!(entries && entries.length === 0) && !(roster.isError && !entries) && (
          <RosterTable
            entries={entries}
            dataUpdatedAt={roster.dataUpdatedAt}
            loading={roster.isPending}
            tab={tab}
            query={query}
            onTabChange={(t) => setUrlParam("tab", t)}
            onQueryChange={(q) => setUrlParam("q", q)}
            onMark={(e) => setMarkTarget({ student_number: e.student_number, full_name: e.full_name, revoked: e.status === "revoked" })}
            onRevoke={setRevokeTarget}
          />
        )}
      </section>

      {/* dialogs */}
      <ManualMarkDialog
        sessionId={sessionId}
        sessionClosed={!!session && !session.is_open}
        student={markTarget === "blank" ? null : markTarget}
        open={markTarget !== null}
        onOpenChange={(open) => { if (!open) setMarkTarget(null); }}
      />
      <RevokeDialog sessionId={sessionId} entry={revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }} />
      {session && <CloseSessionDialog sessionId={sessionId} counts={counts} open={closeOpen} onOpenChange={setCloseOpen} />}
    </div>
  );
}
