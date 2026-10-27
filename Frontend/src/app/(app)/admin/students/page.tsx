"use client"; // client-rendered dashboard page (spec U2)

import { useMemo, useState } from "react"; // React
import { useRouter } from "next/navigation"; // row navigation
import { GraduationCap, UserPlus } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // filters
import { ActiveBadge } from "@/components/admin/active-badge"; // status pill
import { AddStudentDialog } from "@/components/admin/add-student-dialog"; // create
import { ConsentBadge } from "@/components/admin/consent-badge"; // consent pill
import { SearchInput } from "@/components/admin/search-input"; // ?q=
import { DataTable, type Column } from "@/components/data-table"; // table
import { EmptyState } from "@/components/empty-state"; // no results
import { PageHeader } from "@/components/page-header"; // title row
import { PaginationBar } from "@/components/pagination-bar"; // paging
import { ADMIN_PAGE_SIZE, useAdminCourses, useAdminDevices, useAdminStudents } from "@/hooks/use-admin"; // data
import { useQueryState } from "@/hooks/use-query-state"; // URL filters
import { errorMessage } from "@/lib/errors"; // friendly text
import type { StudentOut } from "@/lib/types"; // row type

export default function AdminStudentsPage() { // /admin/students (WP-A4)
  const router = useRouter(); // navigation
  const { get, getNumber, set } = useQueryState(); // ?q=&course=&active=&offset=
  const [addOpen, setAddOpen] = useState(() => get("add") === "1"); // add dialog (?add=1 opens it, e.g. from a course’s "Create these students")
  const q = get("q") ?? ""; // search text
  const course = get("course") ?? "all"; // course filter
  const active = get("active") ?? "true"; // status filter (Active is the default)
  const offset = getNumber("offset", 0); // paging

  const courses = useAdminCourses(); // filter options
  const devices = useAdminDevices(false); // names for the fingerprint chips (no polling here)
  const students = useAdminStudents({ search: q || undefined, courseId: course === "all" ? undefined : Number(course), active: active === "all" ? undefined : active === "true", offset, limit: ADMIN_PAGE_SIZE }); // the list
  const deviceNames = useMemo(() => new Map((devices.data ?? []).map((d) => [d.id, d.name])), [devices.data]); // id → name

  const columns: Column<StudentOut>[] = [ // spec §5.1 columns
    { key: "number", header: "Student number", cell: (s) => <span className="tabular font-mono text-sm text-ink-2">{s.student_number}</span> }, // monospace
    { key: "name", header: "Name", cell: (s) => <span className="font-medium text-ink">{s.full_name}</span> }, // name
    { key: "consent", header: "Consent", cell: (s) => <ConsentBadge consent={s.biometric_consent} /> }, // POPIA
    { key: "fp", header: "Fingerprint", cell: (s) => s.enrolled_device_ids.length === 0 ? <span className="text-sm text-muted-foreground">Not enrolled</span> : ( // terminal chips
      <span className="flex flex-wrap gap-1">{s.enrolled_device_ids.map((id) => <span key={id} className="inline-flex h-6 items-center rounded-md border border-rule px-2 font-mono text-xs text-ink-2">{deviceNames.get(id) ?? `#${id}`}</span>)}</span>
    ) },
    ...(active === "all" ? [{ key: "status", header: "Status", cell: (s: StudentOut) => <ActiveBadge active={s.is_active} /> }] : []), // only when both are listed
  ];

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader title="Students" subtitle="Consent, fingerprints and class lists." actions={<Button size="lg" onClick={() => setAddOpen(true)}><UserPlus className="size-4" aria-hidden />Add student</Button>} />

      {/* toolbar */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <SearchInput label="Search by number or name" placeholder="Search by number or name" />
        <Select value={course} onValueChange={(v) => set({ course: v === "all" ? null : v })}>
          <SelectTrigger className="h-10 w-full" aria-label="Filter by course"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {(courses.data ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={active} onValueChange={(v) => set({ active: v === "true" ? null : v })}>
          <SelectTrigger className="h-10 w-full" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {students.isError && <p role="alert" className="text-sm text-danger">{errorMessage(students.error)}</p>}

      {/* table */}
      <DataTable
        caption="Students"
        columns={columns}
        rows={students.data?.items}
        rowKey={(s) => s.id}
        loading={students.isPending}
        onRowClick={(s) => router.push(`/admin/students/${s.id}`)}
        rowLabel={(s) => `Open ${s.full_name}`}
        empty={<EmptyState icon={GraduationCap} title="No students found" description={q || course !== "all" || active !== "true" ? "Try a different search or filter." : "Add students here, or import a class list on a course page."} action={<Button variant="outline" onClick={() => setAddOpen(true)}><UserPlus className="size-4" aria-hidden />Add student</Button>} />}
      />
      {students.data && students.data.total > 0 && <PaginationBar total={students.data.total} limit={ADMIN_PAGE_SIZE} offset={offset} onChange={(o) => set({ offset: o || null }, { resetOffset: false })} />}

      {/* create dialog */}
      <AddStudentDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
