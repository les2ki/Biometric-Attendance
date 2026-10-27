"use client"; // tabs, search and highlight state

import { useMemo, useState } from "react"; // React
import { ArrowDownWideNarrow, Search, Undo2, UserCheck, UserX } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // row actions
import { Input } from "@/components/ui/input"; // search box
import { Skeleton } from "@/components/ui/skeleton"; // loading rows
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"; // table parts
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"; // All / Present / Absent / Revoked
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"; // details on hover/focus
import { MethodBadge } from "@/components/method-badge"; // Fingerprint / Manual
import { StatusBadge } from "@/components/status-badge"; // Present / Absent / Revoked
import { fmtDateTime, fmtTime } from "@/lib/format"; // time formatting
import type { RosterEntry, RosterStatus } from "@/lib/types"; // row shape
import { cn } from "@/lib/utils"; // class merging

export type RosterTab = "all" | RosterStatus; // which tab is selected
export const ROSTER_TABS: RosterTab[] = ["all", "present", "absent", "revoked"]; // tab order
const TAB_LABELS: Record<RosterTab, string> = { all: "All", present: "Present", absent: "Absent", revoked: "Revoked" }; // tab names

interface RosterTableProps { // inputs from the live page
  entries: RosterEntry[] | undefined; // one per roster student
  dataUpdatedAt: number; // when the last poll succeeded (drives the arrival highlight)
  loading: boolean; // first load in progress
  tab: RosterTab; // selected tab (from ?tab=)
  query: string; // search text (from ?q=)
  onTabChange: (tab: RosterTab) => void; // update ?tab=
  onQueryChange: (query: string) => void; // update ?q=
  onMark: (entry: RosterEntry) => void; // "Mark present" / "Reinstate"
  onRevoke: (entry: RosterEntry) => void; // "Revoke"
}

interface ArrivalTracker { key: number; present: Set<number>; fresh: Set<number>; } // previous poll vs this poll

export function RosterTable({ entries, dataUpdatedAt, loading, tab, query, onTabChange, onQueryChange, onMark, onRevoke }: RosterTableProps) { // the live class list (spec §6.4)
  const [sortByTime, setSortByTime] = useState(false); // optional: newest arrivals first
  const [tracker, setTracker] = useState<ArrivalTracker | null>(null); // who was present at the previous poll

  if (entries && (tracker === null || tracker.key !== dataUpdatedAt)) { // a new poll arrived → work out who just turned present
    const present = new Set(entries.filter((e) => e.status === "present").map((e) => e.student_id)); // present now
    const fresh = tracker === null ? new Set<number>() : new Set([...present].filter((id) => !tracker.present.has(id))); // no highlight on first load
    setTracker({ key: dataUpdatedAt, present, fresh }); // React re-renders straight away with the new set (derived-state pattern)
  }

  const counts = useMemo(() => { // tab counts, computed client-side
    const c: Record<RosterTab, number> = { all: 0, present: 0, absent: 0, revoked: 0 }; // start at zero
    for (const e of entries ?? []) { c.all += 1; c[e.status] += 1; } // tally
    return c; // { all, present, absent, revoked }
  }, [entries]); // recount when data changes

  const rows = useMemo(() => { // filter + search + sort
    const needle = query.trim().toLowerCase(); // case-insensitive search text
    let list = (entries ?? []).filter((e) => tab === "all" || e.status === tab); // tab filter
    if (needle) list = list.filter((e) => e.student_number.toLowerCase().includes(needle) || e.full_name.toLowerCase().includes(needle)); // number or name
    if (sortByTime) list = [...list].sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? "")); // newest first (ISO strings sort correctly)
    return list; // rows to show
  }, [entries, tab, query, sortByTime]); // recompute when inputs change

  return (
    <div className="space-y-3">
      {/* toolbar: tabs + search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* tabs with counts (horizontal scroll on very narrow phones) */}
        <div className="-mx-1 overflow-x-auto overflow-y-hidden px-1 py-0.5">
          <Tabs value={tab} onValueChange={(v) => onTabChange(v as RosterTab)}>
            <TabsList className="h-10">
              {ROSTER_TABS.map((t) => ( // one tab each
                <TabsTrigger key={t} value={t} className="px-3 text-sm">
                  {TAB_LABELS[t]} <span className="tabular ml-1 font-mono text-xs text-muted-foreground">{counts[t]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {/* search box */}
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="roster-search" className="sr-only">Search by student number or name</label>
          <Input id="roster-search" type="search" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Student number or name" className="h-10 pl-9" autoComplete="off" />
        </div>
      </div>

      {/* the table (scrolls sideways inside its border on phones) */}
      <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
        <Table className="min-w-[56rem] text-[0.95rem]">
          <TableCaption className="sr-only">Class list for this session with attendance status</TableCaption>
          {/* headings */}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Student number</TableHead>
              <TableHead>Full name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>
                {/* sortable time column */}
                <button type="button" onClick={() => setSortByTime((v) => !v)} aria-pressed={sortByTime} className="-mx-1 inline-flex items-center gap-1 rounded px-1 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">
                  Time <ArrowDownWideNarrow className={cn("size-3.5", sortByTime ? "text-cobalt" : "text-muted-foreground")} aria-hidden />
                  <span className="sr-only">{sortByTime ? "(sorted newest first, click to sort by name)" : "(click to sort newest first)"}</span>
                </button>
              </TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* loading: 8 skeleton rows */}
            {loading && !entries && Array.from({ length: 8 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
            ))}
            {/* no matches for the current tab/search */}
            {entries && entries.length > 0 && rows.length === 0 && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No students match this filter.</TableCell></TableRow>
            )}
            {/* rows */}
            {rows.map((e) => ( // one student
              <TableRow key={e.student_id} className={cn("h-14", tracker?.fresh.has(e.student_id) && "arrival")}>
                {/* number (data face) */}
                <TableCell className="tabular font-mono text-sm text-ink-2">{e.student_number}</TableCell>
                {/* name */}
                <TableCell className="font-medium text-ink">{e.full_name}</TableCell>
                {/* status */}
                <TableCell><StatusBadge status={e.status} reason={e.revoke_reason} /></TableCell>
                {/* method */}
                <TableCell><MethodBadge method={e.status === "absent" ? null : e.method} /></TableCell>
                {/* time with full detail in a tooltip */}
                <TableCell className="tabular font-mono text-sm">
                  {e.recorded_at ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="rounded outline-none focus-visible:outline-2 focus-visible:outline-ring">{fmtTime(e.recorded_at)}</button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Recorded {fmtDateTime(e.recorded_at)}</p>
                        {e.device_time && <p>Terminal clock {fmtDateTime(e.device_time)}</p>}
                      </TooltipContent>
                    </Tooltip>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                {/* details: manual note or fingerprint score */}
                <TableCell className="max-w-64">
                  {e.method === "manual" && e.note ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="block max-w-full truncate rounded text-left text-sm text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-ring">by {e.recorded_by_name ?? "lecturer"}: {e.note}</button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">by {e.recorded_by_name ?? "lecturer"}: {e.note}</TooltipContent>
                    </Tooltip>
                  ) : e.method === "fingerprint" && e.fp_confidence !== null ? (
                    <span className="tabular font-mono text-xs text-muted-foreground">score {e.fp_confidence}</span>
                  ) : null}
                </TableCell>
                {/* one action per state */}
                <TableCell className="text-right">
                  {e.status === "absent" && <Button variant="outline" size="sm" onClick={() => onMark(e)}><UserCheck className="size-3.5" aria-hidden />Mark present</Button>}
                  {e.status === "present" && <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => onRevoke(e)}><UserX className="size-3.5" aria-hidden />Revoke</Button>}
                  {e.status === "revoked" && <Button variant="outline" size="sm" onClick={() => onMark(e)}><Undo2 className="size-3.5" aria-hidden />Reinstate</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
