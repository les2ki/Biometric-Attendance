"use client"; // client-rendered dashboard page (spec U2)

import { useState } from "react"; // React
import { useRouter } from "next/navigation"; // row navigation
import { useForm } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { BookOpen, LoaderCircle, Plus } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // fields
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // status filter
import { ActiveBadge } from "@/components/admin/active-badge"; // status pill
import { DataTable, type Column } from "@/components/data-table"; // table
import { EmptyState } from "@/components/empty-state"; // no courses
import { FormField } from "@/components/form-field"; // label + message
import { PageHeader } from "@/components/page-header"; // title row
import { useAdminCourses, useCreateCourse } from "@/hooks/use-admin"; // data
import { useQueryState } from "@/hooks/use-query-state"; // ?active=
import { ApiError } from "@/lib/api"; // error type
import { errorMessage } from "@/lib/errors"; // friendly text
import type { CourseOut } from "@/lib/types"; // row type

const schema = z.object({ // admin spec §6.1
  code: z.string().trim().min(1, "Enter a course code, e.g. PD2316D.").max(20, "Codes are at most 20 characters."), // code
  name: z.string().trim().min(1, "Enter the course name.").max(120, "Keep the name to 120 characters or fewer."), // name
});
type CourseValues = z.infer<typeof schema>; // form values

function Warn({ children }: { children: string }) { // amber word for empty counts
  return <span className="inline-flex h-6 items-center rounded-md border border-revoked-line bg-revoked-soft px-2 text-xs font-medium text-revoked">{children}</span>; // e.g. "None"
}

export default function AdminCoursesPage() { // /admin/courses (WP-A6)
  const router = useRouter(); // navigation
  const { get, set } = useQueryState(); // ?active=
  const status = get("active") ?? "true"; // Active is the default
  const courses = useAdminCourses(status === "all" ? undefined : status === "true"); // the list
  const [open, setOpen] = useState(false); // new-course dialog

  const columns: Column<CourseOut>[] = [ // spec §6.1 columns
    { key: "code", header: "Code", cell: (c) => <span className="font-display font-bold text-ink">{c.code}</span>, sortable: (c) => c.code }, // bold code
    { key: "name", header: "Name", cell: (c) => <span className="text-ink-2">{c.name}</span>, sortable: (c) => c.name }, // name
    { key: "lect", header: "Lecturers", className: "text-right", cell: (c) => (c.lecturer_count === 0 ? <Warn>None</Warn> : <span className="tabular">{c.lecturer_count}</span>), sortable: (c) => c.lecturer_count }, // amber when 0
    { key: "stud", header: "Students", className: "text-right", cell: (c) => (c.student_count === 0 ? <Warn>Empty</Warn> : <span className="tabular">{c.student_count}</span>), sortable: (c) => c.student_count }, // amber when 0
    { key: "status", header: "Status", cell: (c) => <ActiveBadge active={c.is_active} inactiveLabel="Archived" /> }, // active / archived
  ];

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader title="Courses" subtitle="Class lists and lecturer assignments." actions={<Button size="lg" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />New course</Button>} />

      {/* toolbar */}
      <div className="w-full sm:w-56">
        <Select value={status} onValueChange={(v) => set({ active: v === "true" ? null : v })}>
          <SelectTrigger className="h-10 w-full" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {courses.isError && <p role="alert" className="text-sm text-danger">{errorMessage(courses.error)}</p>}
      <DataTable
        caption="Courses"
        columns={columns}
        rows={courses.data}
        rowKey={(c) => c.id}
        loading={courses.isPending}
        onRowClick={(c) => router.push(`/admin/courses/${c.id}`)}
        rowLabel={(c) => `Open ${c.code}`}
        minWidth="40rem"
        empty={<EmptyState icon={BookOpen} title={status === "false" ? "No archived courses" : "No courses yet"} description="Create a course, then add its lecturers and class list." action={<Button variant="outline" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />New course</Button>} />}
      />

      {/* new course dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">New course</DialogTitle>
            <DialogDescription>Codes are stored in capitals, e.g. PD2316D.</DialogDescription>
          </DialogHeader>
          {open && <NewCourseForm onDone={(id) => { setOpen(false); if (id) router.push(`/admin/courses/${id}`); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewCourseForm({ onDone }: { onDone: (createdId?: number) => void }) { // the form
  const create = useCreateCourse(); // mutation
  const { register, handleSubmit, formState, setError } = useForm<CourseValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { code: "", name: "" } }); // form state
  const code = register("code"); // so we can upper-case as the user types

  const onSubmit = handleSubmit((values) => { // schema passed
    create.mutate({ code: values.code.trim().toUpperCase(), name: values.name.trim() }, { // POST
      onSuccess: (course) => onDone(course.id), // go to the new course (spec §6.1)
      onError: (err) => { if (err instanceof ApiError && err.code === "course_code_taken") setError("code", { message: errorMessage(err) }); else setError("root", { message: errorMessage(err) }); }, // inline
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <FormField id="course-code" label="Course code" error={formState.errors.code?.message}>
        <Input id="course-code" autoComplete="off" maxLength={20} className="h-11 font-mono" aria-invalid={!!formState.errors.code} aria-describedby="course-code-message" {...code} onChange={(e) => { e.target.value = e.target.value.toUpperCase().trimStart(); code.onChange(e); }} />
      </FormField>
      <FormField id="course-name" label="Course name" error={formState.errors.name?.message}>
        <Input id="course-name" autoComplete="off" maxLength={120} className="h-11" aria-invalid={!!formState.errors.name} aria-describedby="course-name-message" {...register("name")} />
      </FormField>
      {formState.errors.root && <p role="alert" className="text-sm text-danger">{formState.errors.root.message}</p>}
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          Create course
        </Button>
      </DialogFooter>
    </form>
  );
}
