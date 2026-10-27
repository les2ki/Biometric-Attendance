"use client"; // row clicks navigate

import Link from "next/link"; // real links for keyboard users
import { useRouter } from "next/navigation"; // row click navigation
import { ChevronRight } from "lucide-react"; // row affordance
import { Skeleton } from "@/components/ui/skeleton"; // loading rows
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"; // table parts
import { fmtDateTime, fmtPercent, percent } from "@/lib/format"; // formatting
import type { SessionOut } from "@/lib/types"; // session shape
import { cn } from "@/lib/utils"; // class merging

function OpenClosedBadge({ open }: { open: boolean }) { // Open / Closed pill
  return (
    // text label carries the meaning; colour only reinforces it
    <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium", open ? "border-present-line bg-present-soft text-present" : "border-rule text-muted-foreground")}>
      {open ? "Open" : "Closed"}
    </span>
  );
}

interface SessionsTableProps { sessions: SessionOut[] | undefined; loading: boolean; } // data + loading flag

export function SessionsTable({ sessions, loading }: SessionsTableProps) { // "Recent sessions" table (spec §6.3 B)
  const router = useRouter(); // row click → live page

  return (
    // horizontal scroll inside the bordered box on narrow screens; the page itself never scrolls sideways
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
      <Table className="min-w-[44rem]">
        <TableCaption className="sr-only">Recent attendance sessions</TableCaption>
        {/* column headings */}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Course</TableHead>
            <TableHead>Venue</TableHead>
            <TableHead>Terminal</TableHead>
            <TableHead className="text-right">Present</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10"><span className="sr-only">Open</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* loading: skeleton rows keep the layout steady */}
          {loading && !sessions && Array.from({ length: 5 }, (_, i) => (
            <TableRow key={`skeleton-${i}`}>
              <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
            </TableRow>
          ))}
          {/* data rows */}
          {sessions?.map((s) => ( // each session
            <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/lecturer/sessions/${s.id}`)}>
              <TableCell className="tabular font-mono text-xs whitespace-nowrap text-ink-2">{fmtDateTime(s.opened_at)}</TableCell>
              <TableCell>
                <span className="font-medium text-ink">{s.course_code}</span>
                <span className="block max-w-56 truncate text-xs text-muted-foreground">{s.course_name}</span>
              </TableCell>
              <TableCell className="max-w-48 truncate">{s.venue}</TableCell>
              <TableCell className="whitespace-nowrap">{s.device_name}</TableCell>
              <TableCell className="tabular text-right whitespace-nowrap">
                {s.counts.present} / {s.counts.roster}
                <span className="ml-2 text-xs text-muted-foreground">{fmtPercent(percent(s.counts.present, s.counts.roster))}</span>
              </TableCell>
              <TableCell><OpenClosedBadge open={s.is_open} /></TableCell>
              <TableCell>
                {/* keyboard-reachable link (the row click is a mouse convenience) */}
                <Link href={`/lecturer/sessions/${s.id}`} onClick={(e) => e.stopPropagation()} className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Open ${s.course_code} session of ${fmtDateTime(s.opened_at)}`}>
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
