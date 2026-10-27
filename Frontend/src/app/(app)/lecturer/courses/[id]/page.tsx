"use client"; // client-rendered dashboard page (spec U2)

import { useMemo, useState } from "react"; // React
import Link from "next/link"; // breadcrumb
import { notFound, useParams } from "next/navigation"; // route id
import { ArrowDownUp, ChartColumn, ChevronRight, Download, RotateCw, TriangleAlert } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Skeleton } from "@/components/ui/skeleton"; // loading
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"; // table parts
import { EmptyState } from "@/components/empty-state"; // no data
import { PageHeader } from "@/components/page-header"; // title row
import { useCourseReport } from "@/hooks/use-lecturer"; // data
import { ApiError, saveBlob } from "@/lib/api"; // 404 detection + client-side download
import { errorMessage } from "@/lib/errors"; // friendly text
import { AT_RISK_THRESHOLD, fmtDateKey, fmtPercent } from "@/lib/format"; // threshold + formatting
import type { CourseReport, ReportRow } from "@/lib/types"; // report shapes
import { cn } from "@/lib/utils"; // class merging

type SortOrder = "name" | "pct-asc" | "pct-desc"; // how rows are ordered

function csvCell(value: string | number): string { // quote a CSV cell when needed
  const text = String(value); // stringify
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; // RFC 4180 quoting
}

function downloadReportCsv(report: CourseReport): void { // build the CSV in the browser (spec §7: no backend endpoint)
  const header = ["student_number", "full_name", "attended", "closed_sessions", "percentage", "at_risk"]; // columns
  const lines = report.students.map((r) => [r.student_number, r.full_name, r.attended, report.closed_sessions, r.percentage.toFixed(1), r.percentage < AT_RISK_THRESHOLD ? "yes" : "no"].map(csvCell).join(",")); // one line per student
  const text = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8
  saveBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), `report_${report.course.code}_${fmtDateKey(new Date())}.csv`); // trigger the download
}

export default function CourseReportPage() { // /lecturer/courses/[id] (WP7)
  const { id } = useParams<{ id: string }>(); // route parameter
  const courseId = Number(id); // numeric id
  if (!Number.isInteger(courseId) || courseId <= 0) notFound(); // bad URL → 404
  return <Report courseId={courseId} />; // the page body
}

function Report({ courseId }: { courseId: number }) { // split out so hooks always run in the same order
  const report = useCourseReport(courseId); // GET /lecturer/courses/{id}/report
  const [order, setOrder] = useState<SortOrder>("name"); // backend order is by name

  const rows = useMemo<ReportRow[]>(() => { // sorted copy
    const list = [...(report.data?.students ?? [])]; // don't mutate the cache
    if (order === "pct-asc") list.sort((a, b) => a.percentage - b.percentage); // lowest first (who needs attention)
    if (order === "pct-desc") list.sort((a, b) => b.percentage - a.percentage); // highest first
    return list; // rows to render
  }, [report.data, order]); // re-sort when data or order changes

  const nextOrder = (): SortOrder => (order === "pct-asc" ? "pct-desc" : "pct-asc"); // toggle on the header button
  const atRisk = rows.filter((r) => r.percentage < AT_RISK_THRESHOLD).length; // students below the threshold

  if (report.error instanceof ApiError && report.error.status === 404) { // not mine / doesn't exist
    return <EmptyState icon={ChartColumn} title="Course not found" description="You may not be assigned to this course." action={<Button asChild variant="outline"><Link href="/lecturer/courses">Back to Courses</Link></Button>} />; // dead end with a way back
  }

  const data = report.data; // shorthand

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader
        breadcrumb={
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/lecturer/courses" className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">Courses</Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span aria-current="page" className="text-ink-2">{data?.course.code ?? "…"}</span>
          </nav>
        }
        title={data ? `${data.course.code} — ${data.course.name}` : <Skeleton className="h-8 w-72" />}
        subtitle={data ? `Based on ${data.closed_sessions} closed ${data.closed_sessions === 1 ? "session" : "sessions"}. Students below ${AT_RISK_THRESHOLD}% are marked at risk.` : undefined}
        actions={data && data.students.length > 0 ? <Button variant="outline" size="lg" onClick={() => downloadReportCsv(data)}><Download className="size-4" aria-hidden />Download CSV</Button> : undefined}
      />

      {/* error */}
      {report.isError && !(report.error instanceof ApiError && report.error.status === 404) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          {errorMessage(report.error)}
          <Button variant="outline" size="sm" onClick={() => report.refetch()}><RotateCw className="size-4" aria-hidden />Retry</Button>
        </div>
      )}

      {/* loading */}
      {report.isPending && <Skeleton className="h-64 rounded-lg" />}

      {/* no closed sessions yet */}
      {data && data.closed_sessions === 0 && (
        <EmptyState icon={ChartColumn} title="No closed sessions yet" description="Percentages are calculated from closed sessions only. Close a session to include it here." action={<Button asChild variant="outline"><Link href="/lecturer">Go to Sessions</Link></Button>} />
      )}

      {/* the report table */}
      {data && data.closed_sessions > 0 && (
        <section aria-label="Attendance per student" className="space-y-3">
          {/* summary line */}
          <p className="tabular text-sm text-muted-foreground">{rows.length} students · {atRisk} at risk</p>
          <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
            <Table className="min-w-[40rem]">
              <TableCaption className="sr-only">Attendance percentage per student across closed sessions</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student number</TableHead>
                  <TableHead>Full name</TableHead>
                  <TableHead className="text-right">Attended</TableHead>
                  <TableHead className="w-[40%]">
                    {/* sortable percentage column */}
                    <button type="button" onClick={() => setOrder(nextOrder())} className="-mx-1 inline-flex items-center gap-1 rounded px-1 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">
                      Attendance <ArrowDownUp className={cn("size-3.5", order === "name" ? "text-muted-foreground" : "text-cobalt")} aria-hidden />
                      <span className="sr-only">{order === "pct-asc" ? "(lowest first)" : order === "pct-desc" ? "(highest first)" : "(click to sort)"}</span>
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => { // each student
                  const risk = r.percentage < AT_RISK_THRESHOLD; // below the threshold?
                  return (
                    <TableRow key={r.student_id}>
                      <TableCell className="tabular font-mono text-sm text-ink-2">{r.student_number}</TableCell>
                      <TableCell className="font-medium text-ink">{r.full_name}</TableCell>
                      <TableCell className="tabular text-right">{r.attended} / {data.closed_sessions}</TableCell>
                      <TableCell>
                        {/* bar + number + at-risk badge */}
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-paper-3" aria-hidden>
                            <div className={cn("h-full w-full origin-left rounded-full", risk ? "bg-revoked" : "bg-present")} style={{ transform: `scaleX(${r.percentage / 100})` }} />
                          </div>
                          <span className="tabular w-14 text-right text-sm font-medium text-ink">{fmtPercent(r.percentage)}</span>
                          {risk && (
                            <span className="inline-flex h-6 items-center gap-1 rounded-md border border-revoked-line bg-revoked-soft px-2 text-xs font-medium whitespace-nowrap text-revoked">
                              <TriangleAlert className="size-3.5" aria-hidden />At risk
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
