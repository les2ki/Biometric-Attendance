"use client"; // client-rendered dashboard page (spec U2)

import { useMemo, useState, type ReactNode } from "react"; // React
import Link from "next/link"; // navigation
import { notFound, useParams } from "next/navigation"; // route id
import { Archive, ArchiveRestore, BookOpen, ChevronRight, FileUp, Pencil, Search, UserMinus, UserPlus, Users, X } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Input } from "@/components/ui/input"; // client-side search
import { Skeleton } from "@/components/ui/skeleton"; // loading
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"; // All / Not enrolled
import { ActiveBadge } from "@/components/admin/active-badge"; // status pill
import { ConsentBadge } from "@/components/admin/consent-badge"; // consent pill
import { AddStudentsDialog, EditLecturersDialog, ImportCsvDialog, RenameCourseDialog } from "@/components/admin/course-dialogs"; // dialogs
import { ConfirmDialog } from "@/components/confirm-dialog"; // destructive confirms
import { DataTable, type Column } from "@/components/data-table"; // roster table
import { EmptyState } from "@/components/empty-state"; // not found / empty
import { PageHeader } from "@/components/page-header"; // title row
import { useAdminCourse, useRemoveStudent, useUpdateCourse } from "@/hooks/use-admin"; // data
import { useQueryState } from "@/hooks/use-query-state"; // ?tab=
import { ApiError } from "@/lib/api"; // 404 detection
import { errorMessage } from "@/lib/errors"; // friendly text
import type { RosterImportOut, StudentOut } from "@/lib/types"; // shapes

export default function AdminCoursePage() { // /admin/courses/[id] (WP-A6)
  const { id } = useParams<{ id: string }>(); // route parameter
  const courseId = Number(id); // numeric id
  if (!Number.isInteger(courseId) || courseId <= 0) notFound(); // bad URL → 404
  return <CourseView courseId={courseId} />; // page body
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) { // one ruled section
  return (
    <section className="space-y-3 rounded-lg border border-rule bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

type RosterResult = Partial<RosterImportOut> & { added: string[]; already_present: string[]; unknown: string[] }; // add or import result

function CourseView({ courseId }: { courseId: number }) { // split out so hooks run in a fixed order
  const course = useAdminCourse(courseId); // GET /admin/courses/{id}
  const update = useUpdateCourse(courseId); // PATCH (archive / restore)
  const remove = useRemoveStudent(courseId); // DELETE roster row
  const { get, set } = useQueryState(); // ?tab=
  const tab = get("tab") === "not-enrolled" ? "not-enrolled" : "all"; // roster tab
  const [search, setSearch] = useState(""); // client-side roster search
  const [result, setResult] = useState<RosterResult | null>(null); // last add/import result (stays until dismissed)
  const [dialog, setDialog] = useState<"rename" | "lecturers" | "add" | "import" | "archive" | null>(null); // which dialog is open
  const [removeTarget, setRemoveTarget] = useState<StudentOut | null>(null); // remove confirm

  const c = course.data; // shorthand
  const rows = useMemo(() => { // tab + search
    const needle = search.trim().toLowerCase(); // case-insensitive
    return (c?.students ?? []) // the roster
      .filter((s) => tab === "all" || s.enrolled_device_ids.length === 0) // "Not enrolled" tab
      .filter((s) => !needle || s.student_number.includes(needle) || s.full_name.toLowerCase().includes(needle)); // search
  }, [c, tab, search]); // recompute

  if (course.error instanceof ApiError && course.error.status === 404) { // unknown course
    return <EmptyState icon={BookOpen} title="Course not found" action={<Button asChild variant="outline"><Link href="/admin/courses">Back to Courses</Link></Button>} />; // dead end with a way back
  }
  if (course.isError) return <p role="alert" className="text-sm text-danger">{errorMessage(course.error)}</p>; // other errors
  if (!c) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-64 rounded-lg" /></div>; // loading

  const withConsent = c.students.filter((s) => s.biometric_consent).length; // summary numbers (spec §6.2)
  const enrolled = c.students.filter((s) => s.enrolled_device_ids.length > 0).length; // has a fingerprint somewhere
  const columns: Column<StudentOut>[] = [ // roster columns
    { key: "number", header: "Student number", cell: (s) => <Link href={`/admin/students/${s.id}`} className="tabular rounded font-mono text-sm text-ink-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring">{s.student_number}</Link> }, // links to the student
    { key: "name", header: "Name", cell: (s) => <span className="font-medium text-ink">{s.full_name}</span>, sortable: (s) => s.full_name }, // name
    { key: "consent", header: "Consent", cell: (s) => <ConsentBadge consent={s.biometric_consent} /> }, // POPIA
    { key: "fp", header: "Fingerprint", cell: (s) => (s.enrolled_device_ids.length > 0 ? <span className="text-sm text-present">Enrolled</span> : <span className="text-sm text-muted-foreground">Not enrolled</span>) }, // enrolled or not
    { key: "remove", header: <span className="sr-only">Remove</span>, className: "text-right", cell: (s) => <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setRemoveTarget(s)} aria-label={`Remove ${s.full_name} from ${c.code}`}><UserMinus className="size-3.5" aria-hidden />Remove</Button> }, // confirm first
  ];

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader
        breadcrumb={<nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground"><Link href="/admin/courses" className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">Courses</Link><ChevronRight className="size-3.5" aria-hidden /><span aria-current="page" className="text-ink-2">{c.code}</span></nav>}
        title={`${c.code} — ${c.name}`}
        subtitle={<ActiveBadge active={c.is_active} inactiveLabel="Archived" />}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog("rename")}><Pencil className="size-4" aria-hidden />Rename</Button>
            {c.is_active
              ? <Button variant="outline" onClick={() => setDialog("archive")}><Archive className="size-4" aria-hidden />Archive</Button>
              : <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ is_active: true })}><ArchiveRestore className="size-4" aria-hidden />Restore</Button>}
          </>
        }
      />

      {/* lecturers */}
      <Card title="Lecturers" action={<Button size="sm" variant="outline" onClick={() => setDialog("lecturers")}><Users className="size-3.5" aria-hidden />Edit lecturers</Button>}>
        {c.lecturers.length === 0 ? <p className="text-sm text-revoked">No lecturer assigned yet. Nobody can open sessions for this course.</p> : (
          <div className="flex flex-wrap gap-2">{c.lecturers.map((u) => <span key={u.id} className="inline-flex flex-col rounded-md border border-rule px-2.5 py-1.5"><span className="text-sm font-medium text-ink">{u.full_name}{!u.is_active && <span className="ml-2 text-xs text-revoked">Inactive</span>}</span><span className="text-xs text-muted-foreground">{u.email}</span></span>)}</div>
        )}
        <p className="text-xs text-muted-foreground">Lecturers only see courses they’re assigned to.</p>
      </Card>

      {/* class list */}
      <Card
        title="Class list"
        action={<div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setDialog("add")}><UserPlus className="size-3.5" aria-hidden />Add students</Button><Button size="sm" variant="outline" onClick={() => setDialog("import")}><FileUp className="size-3.5" aria-hidden />Import CSV</Button></div>}
      >
        {/* summary line: who still needs enrolling */}
        <p className="tabular text-sm text-ink-2">{c.students.length} students · {withConsent} with consent · {enrolled} enrolled</p>

        {/* result of the last add / import (stays until dismissed) */}
        {result && <ResultPanel result={result} onDismiss={() => setResult(null)} />}

        {/* toolbar: tabs + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={tab} onValueChange={(v) => set({ tab: v === "all" ? null : v })}>
            <TabsList className="h-10">
              <TabsTrigger value="all" className="px-3">All <span className="tabular ml-1 font-mono text-xs text-muted-foreground">{c.students.length}</span></TabsTrigger>
              <TabsTrigger value="not-enrolled" className="px-3">Not enrolled <span className="tabular ml-1 font-mono text-xs text-muted-foreground">{c.students.length - enrolled}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="roster-search" className="sr-only">Search the class list</label>
            <Input id="roster-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number or name" className="h-10 pl-9" autoComplete="off" />
          </div>
        </div>

        <DataTable caption={`Class list for ${c.code}`} columns={columns} rows={rows} rowKey={(s) => s.id} minWidth="38rem" empty={<p className="py-4 text-sm text-muted-foreground">{c.students.length === 0 ? "Nobody yet. Add student numbers or import a CSV." : "No students match."}</p>} />
      </Card>

      {/* dialogs */}
      <RenameCourseDialog course={c} open={dialog === "rename"} onOpenChange={(o) => setDialog(o ? "rename" : null)} />
      <EditLecturersDialog course={c} open={dialog === "lecturers"} onOpenChange={(o) => setDialog(o ? "lecturers" : null)} />
      <AddStudentsDialog course={c} open={dialog === "add"} onOpenChange={(o) => setDialog(o ? "add" : null)} onResult={setResult} />
      <ImportCsvDialog course={c} open={dialog === "import"} onOpenChange={(o) => setDialog(o ? "import" : null)} onResult={setResult} />
      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(o) => setDialog(o ? "archive" : null)}
        title={`Archive ${c.code}?`}
        description={<p>Lecturers won’t be able to open new sessions for this course. Existing records are kept.</p>}
        confirmLabel="Archive course"
        onConfirm={() => update.mutateAsync({ is_active: false })}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title={`Remove ${removeTarget?.full_name ?? ""} from ${c.code}?`}
        description={<p>Their past attendance in this course is kept.</p>}
        confirmLabel="Remove"
        destructive
        onConfirm={() => remove.mutateAsync(removeTarget?.id ?? 0)}
      />
    </div>
  );
}

function ResultPanel({ result, onDismiss }: { result: RosterResult; onDismiss: () => void }) { // added / already / unknown (+ created) (spec §6.2–6.3)
  return (
    <div className="relative space-y-1 rounded-md border border-rule bg-paper-2 px-3 py-3 pr-10 text-sm" aria-live="polite">
      <button type="button" onClick={onDismiss} aria-label="Dismiss result" className="absolute top-2 right-2 grid size-7 place-items-center rounded text-muted-foreground hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" aria-hidden /></button>
      <p className="font-medium text-present">Added {result.added.length}</p>
      {result.created && result.created.length > 0 && <p className="text-cobalt">Created {result.created.length} new {result.created.length === 1 ? "student" : "students"} (consent not yet recorded)</p>}
      <p className="text-ink-2">Already on the list {result.already_present.length}</p>
      {result.unknown.length > 0 && (
        <div className="text-revoked">
          <p>Unknown numbers {result.unknown.length}: <span className="font-mono text-xs break-all">{result.unknown.join(", ")}</span></p>
          <Link href="/admin/students?add=1" className="text-sm text-cobalt underline-offset-4 hover:underline">Create these students</Link>
        </div>
      )}
    </div>
  );
}
