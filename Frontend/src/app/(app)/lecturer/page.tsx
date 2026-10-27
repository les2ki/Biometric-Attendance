"use client"; // client-rendered dashboard page (spec U2)

import { useState } from "react"; // local UI state
import { usePathname, useRouter, useSearchParams } from "next/navigation"; // ?course= filter in the URL
import { CalendarPlus, CalendarX2, RotateCw } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // course filter
import { Skeleton } from "@/components/ui/skeleton"; // loading cards
import { EmptyState } from "@/components/empty-state"; // nothing running / no sessions
import { PageHeader } from "@/components/page-header"; // title row
import { PaginationBar } from "@/components/pagination-bar"; // Previous / Next
import { OpenSessionDialog } from "@/components/lecturer/open-session-dialog"; // start a session
import { SessionCard } from "@/components/lecturer/session-card"; // running session
import { SessionsTable } from "@/components/lecturer/sessions-table"; // history
import { useLecturerCourses, useOpenSessions, useSessions } from "@/hooks/use-lecturer"; // data
import { useAuth } from "@/lib/auth"; // greeting name
import { errorMessage } from "@/lib/errors"; // friendly error text
import { firstName, greeting } from "@/lib/format"; // "Good morning, Lee"

const PAGE_SIZE = 20; // spec §6.3: 20 per page

export default function SessionsOverviewPage() { // /lecturer (WP5)
  const { user, hasRole } = useAuth(); // for the greeting (+ admin note)
  const router = useRouter(); // URL updates
  const pathname = usePathname(); // "/lecturer"
  const searchParams = useSearchParams(); // ?course=<id> (set by the Courses page)
  const courseParam = Number(searchParams.get("course")); // NaN/0 when absent
  const courseId = Number.isInteger(courseParam) && courseParam > 0 ? courseParam : undefined; // valid filter or none
  const [offset, setOffset] = useState(0); // pagination
  const [dialogOpen, setDialogOpen] = useState(false); // "Open session" dialog

  const courses = useLecturerCourses(); // filter options
  const running = useOpenSessions(); // section A
  const recent = useSessions({ courseId, offset, limit: PAGE_SIZE }); // section B

  const setCourseFilter = (value: string) => { // change the filter (kept in the URL so refresh/back keep it)
    setOffset(0); // back to page 1
    const params = new URLSearchParams(searchParams.toString()); // copy current params
    if (value === "all") params.delete("course"); // "All courses"
    else params.set("course", value); // one course
    const query = params.toString(); // "course=3" or ""
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }); // update the URL without jumping
  };

  return (
    <div className="space-y-8">
      {/* header: title, greeting, primary action */}
      <PageHeader
        title="Sessions"
        subtitle={user ? `${greeting()}, ${firstName(user.full_name)}.${hasRole("admin") ? " Viewing all courses (administrator)." : ""}` : undefined}
        actions={<Button size="lg" onClick={() => setDialogOpen(true)}><CalendarPlus className="size-4" aria-hidden />Open session</Button>}
      />

      {/* section A — running now */}
      <section aria-labelledby="running-heading" className="space-y-3">
        <h2 id="running-heading" className="text-lg font-semibold">Running now</h2>
        {/* loading */}
        {running.isPending && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-48 rounded-lg" />
          </div>
        )}
        {/* error */}
        {running.isError && <p role="alert" className="text-sm text-danger">{errorMessage(running.error)}</p>}
        {/* empty */}
        {running.isSuccess && running.data.items.length === 0 && (
          <EmptyState
            icon={CalendarX2}
            title="No session running"
            description="Open a session to start taking attendance on a terminal."
            action={<Button variant="outline" onClick={() => setDialogOpen(true)}><CalendarPlus className="size-4" aria-hidden />Open session</Button>}
          />
        )}
        {/* cards */}
        {running.isSuccess && running.data.items.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {running.data.items.map((s) => <SessionCard key={s.id} session={s} />)}
          </div>
        )}
      </section>

      {/* section B — recent sessions */}
      <section aria-labelledby="recent-heading" className="space-y-3">
        {/* heading + course filter */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="recent-heading" className="text-lg font-semibold">Recent sessions</h2>
          <div className="w-full sm:w-72">
            <label htmlFor="course-filter" className="sr-only">Filter by course</label>
            <Select value={courseId ? String(courseId) : "all"} onValueChange={setCourseFilter}>
              <SelectTrigger id="course-filter" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All courses</SelectItem>
                {(courses.data ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* error with retry */}
        {recent.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
            {errorMessage(recent.error)}
            <Button variant="outline" size="sm" onClick={() => recent.refetch()}><RotateCw className="size-4" aria-hidden />Retry</Button>
          </div>
        )}
        {/* empty */}
        {recent.isSuccess && recent.data.total === 0 && (
          <EmptyState icon={CalendarX2} title="No sessions yet" description={courseId ? "No sessions for this course yet." : "Sessions you open appear here, newest first."} />
        )}
        {/* table + pagination */}
        {!(recent.isSuccess && recent.data.total === 0) && !recent.isError && (
          <>
            <SessionsTable sessions={recent.data?.items} loading={recent.isPending} />
            {recent.data && <PaginationBar offset={offset} limit={PAGE_SIZE} total={recent.data.total} onChange={setOffset} />}
          </>
        )}
      </section>

      {/* the dialog (pre-selects the filtered course) */}
      <OpenSessionDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultCourseId={courseId} />
    </div>
  );
}
