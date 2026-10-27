"use client"; // client-rendered dashboard page (spec U2)

import Link from "next/link"; // navigation
import { BookOpen, ChartColumn, ListChecks, RotateCw } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Skeleton } from "@/components/ui/skeleton"; // loading
import { EmptyState } from "@/components/empty-state"; // no courses
import { PageHeader } from "@/components/page-header"; // title row
import { useLecturerCourses } from "@/hooks/use-lecturer"; // data
import { errorMessage } from "@/lib/errors"; // friendly text

export default function CoursesPage() { // /lecturer/courses (WP7)
  const courses = useLecturerCourses(); // GET /lecturer/courses

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader title="Courses" subtitle="The courses you teach, with their class lists and attendance reports." />

      {/* loading */}
      {courses.isPending && <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>}

      {/* error */}
      {courses.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          {errorMessage(courses.error)}
          <Button variant="outline" size="sm" onClick={() => courses.refetch()}><RotateCw className="size-4" aria-hidden />Retry</Button>
        </div>
      )}

      {/* empty */}
      {courses.isSuccess && courses.data.length === 0 && (
        <EmptyState icon={BookOpen} title="You’re not assigned to any course yet" description="An administrator assigns lecturers to courses. Once that’s done, your courses appear here." />
      )}

      {/* list: one ruled row per course (an index, not a card grid) */}
      {courses.isSuccess && courses.data.length > 0 && (
        <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-surface">
          {courses.data.map((c) => ( // each course
            <li key={c.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
              {/* course identity + counts */}
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-lg font-bold text-ink">{c.code}</span>
                  <span className="text-ink-2">{c.name}</span>
                </p>
                <p className="tabular text-sm text-muted-foreground">
                  {c.student_count} {c.student_count === 1 ? "student" : "students"} · {c.lecturer_count} {c.lecturer_count === 1 ? "lecturer" : "lecturers"}
                </p>
              </div>
              {/* two actions (spec §7) */}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><Link href={`/lecturer?course=${c.id}`}><ListChecks className="size-4" aria-hidden />View sessions</Link></Button>
                <Button asChild variant="outline"><Link href={`/lecturer/courses/${c.id}`}><ChartColumn className="size-4" aria-hidden />Attendance report</Link></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
