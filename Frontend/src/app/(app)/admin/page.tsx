"use client"; // client-rendered dashboard page (spec U2)

import Link from "next/link"; // navigation
import type { ReactNode } from "react"; // children type
import { ArrowRight, BookOpen, CalendarCheck, CircleCheck, Cpu, TriangleAlert, Users } from "lucide-react"; // icons
import { Skeleton } from "@/components/ui/skeleton"; // loading
import { PageHeader } from "@/components/page-header"; // title row
import { CommandStatusBadge } from "@/components/admin/command-status-badge"; // failed / expired
import { commandTypeText } from "@/components/admin/command-type-label"; // "Enrol fingerprint"
import { useAdminAudit, useAdminCourses, useAdminDevices, useAdminStudents, useAllDeviceCommands } from "@/hooks/use-admin"; // admin data
import { useSessions } from "@/hooks/use-lecturer"; // running sessions count
import { useNow } from "@/hooks/use-now"; // "offline for 5 min" check
import { actionLabel } from "@/lib/audit-labels"; // human sentences
import { useAuth } from "@/lib/auth"; // greeting name
import { firstName, fmtDateTime, fmtRelative, greeting } from "@/lib/format"; // formatting
import { cn } from "@/lib/utils"; // class merging

const SAMPLE = 200; // students fetched to count missing consent (the API has no consent filter)
const OFFLINE_ALERT_MS = 5 * 60_000; // spec §4: offline for more than 5 minutes
const DAY_MS = 24 * 60 * 60_000; // last 24 h for failed/expired commands

interface TileProps { href: string; label: string; icon: typeof Users; value: ReactNode; sub: ReactNode; warn?: boolean; } // one clickable tile

function Tile({ href, label, icon: Icon, value, sub, warn }: TileProps) { // headline number that links to its page
  return (
    // the whole tile is a link; amber border when something needs a look
    <Link href={href} className={cn("group flex flex-col gap-2 rounded-lg border bg-surface px-4 py-3 outline-none transition-colors duration-(--dur-short) ease-out hover:border-cobalt/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", warn ? "border-revoked-line" : "border-rule")}>
      <span className="flex items-center justify-between gap-2 font-mono text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}<Icon className={cn("size-4", warn ? "text-revoked" : "text-muted-foreground")} aria-hidden />
      </span>
      <span className="tabular font-display text-2xl leading-none font-semibold text-ink md:text-3xl">{value}</span>
      <span className={cn("text-xs", warn ? "text-revoked" : "text-muted-foreground")}>{sub}</span>
    </Link>
  );
}

export default function AdminOverviewPage() { // /admin (WP-A3)
  const { user } = useAuth(); // greeting
  const now = useNow(30_000); // offline-duration checks
  const studentsTotal = useAdminStudents({ limit: 1 }); // total only
  const activeStudents = useAdminStudents({ active: true, limit: SAMPLE }); // to count missing consent
  const courses = useAdminCourses(true); // active courses
  const devices = useAdminDevices(15_000); // spec §4: devices every 15 s
  const running = useSessions({ openOnly: true, limit: 1 }); // sessions running now (total)
  const audit = useAdminAudit({ limit: 10 }); // recent activity
  const commandQueries = useAllDeviceCommands(devices.data); // last 20 commands per terminal

  const noConsent = (activeStudents.data?.items ?? []).filter((s) => !s.biometric_consent).length; // active students without consent
  const partial = (activeStudents.data?.total ?? 0) > SAMPLE; // more than we counted
  const activeDevices = (devices.data ?? []).filter((d) => d.is_active); // in service
  const online = activeDevices.filter((d) => d.online).length; // online now
  const waiting = (devices.data ?? []).reduce((sum, d) => sum + d.pending_commands, 0); // queued commands
  const anyOffline = online < activeDevices.length; // amber tile

  const attention: { key: string; node: ReactNode; href: string }[] = []; // "Needs attention" items
  for (const d of activeDevices) { // offline terminals
    const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0; // 0 = never
    if (!d.online && now - seen > OFFLINE_ALERT_MS) attention.push({ key: `dev-${d.id}`, href: "/admin/devices", node: <><strong className="font-medium text-ink">{d.name}</strong> is offline (last seen {fmtRelative(d.last_seen_at, now)}).</> }); // older than 5 min
  }
  commandQueries.forEach((q, i) => { // failed / expired commands in the last 24 h
    const device = devices.data?.[i]; // matching terminal
    for (const c of q.data?.items ?? []) { // each recent command
      const at = new Date(c.completed_at ?? c.created_at).getTime(); // when it ended
      if ((c.status === "failed" || c.status === "expired") && now - at < DAY_MS) attention.push({ // recent problem
        key: `cmd-${c.id}`, // unique
        href: c.student_id ? `/admin/students/${c.student_id}` : "/admin/devices", // where to fix it
        node: <span className="inline-flex flex-wrap items-center gap-2">{commandTypeText(c.type)} for {c.student_number ?? "a removed student"} on {device?.name ?? "a terminal"} <CommandStatusBadge status={c.status} /></span>, // what happened
      });
    }
  });
  for (const c of courses.data ?? []) { // incomplete courses
    if (c.lecturer_count === 0) attention.push({ key: `cl-${c.id}`, href: `/admin/courses/${c.id}`, node: <><strong className="font-medium text-ink">{c.code}</strong> has no lecturer.</> }); // nobody can run sessions
    if (c.student_count === 0) attention.push({ key: `cs-${c.id}`, href: `/admin/courses/${c.id}`, node: <><strong className="font-medium text-ink">{c.code}</strong> has an empty class list.</> }); // nobody to mark
  }

  return (
    <div className="space-y-8">
      {/* header */}
      <PageHeader title="Administration" subtitle={user ? `${greeting()}, ${firstName(user.full_name)}.` : undefined} />

      {/* tiles: 2×2 on phones, 4 across on desktop */}
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/admin/students" label="Students" icon={Users} value={studentsTotal.data ? `${studentsTotal.data.total}` : "—"} sub={activeStudents.data ? `${noConsent}${partial ? "+" : ""} without biometric consent` : "Loading…"} />
        <Tile href="/admin/courses" label="Courses" icon={BookOpen} value={courses.data ? courses.data.length : "—"} sub="active courses" />
        <Tile href="/admin/devices" label="Terminals" icon={Cpu} warn={anyOffline} value={devices.data ? `${online} / ${activeDevices.length}` : "—"} sub={devices.data ? `online · ${waiting} ${waiting === 1 ? "command" : "commands"} waiting` : "Loading…"} />
        <Tile href="/lecturer" label="Sessions" icon={CalendarCheck} value={running.data ? running.data.total : "—"} sub="running now" />
      </section>

      {/* panels: needs attention (narrow) + recent activity (wide) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* needs attention */}
        <section aria-labelledby="attention-heading" className="space-y-3">
          <h2 id="attention-heading" className="text-lg font-semibold">Needs attention</h2>
          {devices.isPending || courses.isPending ? <Skeleton className="h-32 rounded-lg" /> : attention.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-rule bg-surface px-4 py-3 text-sm text-ink-2"><CircleCheck className="size-4 text-present" aria-hidden />All good.</p>
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-revoked-line bg-surface">
              {attention.map((a) => ( // each item links to where it's fixed
                <li key={a.key}>
                  <Link href={a.href} className="flex items-start gap-2 px-4 py-3 text-sm text-ink-2 outline-none hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-revoked" aria-hidden /><span className="min-w-0">{a.node}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* recent activity */}
        <section aria-labelledby="activity-heading" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 id="activity-heading" className="text-lg font-semibold">Recent activity</h2>
            <Link href="/admin/audit" className="inline-flex items-center gap-1 rounded text-sm whitespace-nowrap text-cobalt hover:underline focus-visible:outline-2 focus-visible:outline-ring">View audit log <ArrowRight className="size-3.5" aria-hidden /></Link>
          </div>
          {audit.isPending && <Skeleton className="h-64 rounded-lg" />}
          {audit.data && audit.data.items.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {audit.data && audit.data.items.length > 0 && (
            <ol className="divide-y divide-rule rounded-lg border border-rule bg-surface">
              {audit.data.items.map((a) => ( // each entry as a sentence
                <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                  <time dateTime={a.created_at} title={fmtDateTime(a.created_at)} className="tabular w-24 shrink-0 font-mono text-xs text-muted-foreground">{fmtRelative(a.created_at, now)}</time>
                  <p className="min-w-0 text-sm text-ink-2"><span className="font-medium text-ink">{a.actor_name ?? "System / terminal"}</span> · {actionLabel(a.action)} <span className="font-mono text-xs text-muted-foreground">{a.entity} #{a.entity_id}</span></p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
