"use client"; // client-rendered dashboard page (spec U2)

import { useEffect, useMemo, useState, type ReactNode } from "react"; // React
import Link from "next/link"; // navigation
import { notFound, useParams } from "next/navigation"; // route id
import { useQueryClient } from "@tanstack/react-query"; // refresh command histories
import { Ban, ChevronRight, Fingerprint, Info, Pencil, RotateCcw, ShieldCheck, ShieldOff, Trash2, UserRound } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Skeleton } from "@/components/ui/skeleton"; // loading
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"; // slots table
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"; // disabled-button reasons
import { ActiveBadge } from "@/components/admin/active-badge"; // status pill
import { CommandStatusBadge } from "@/components/admin/command-status-badge"; // command state
import { CommandTypeLabel } from "@/components/admin/command-type-label"; // Enrol / Wipe
import { ConsentBadge } from "@/components/admin/consent-badge"; // consent pill
import { EditStudentDialog } from "@/components/admin/edit-student-dialog"; // rename
import { countdown, EnrolDialog } from "@/components/admin/enrol-dialog"; // guided enrolment
import { RecordConsentDialog } from "@/components/admin/record-consent-dialog"; // grant consent
import { ConfirmDialog } from "@/components/confirm-dialog"; // destructive confirms
import { EmptyState } from "@/components/empty-state"; // not found
import { PageHeader } from "@/components/page-header"; // title row
import { useAdminDevices, useAdminStudent, useAllDeviceCommands, useCancelCommand, useDeleteFingerprints, useSetConsent, useUpdateStudent } from "@/hooks/use-admin"; // data
import { useNow } from "@/hooks/use-now"; // relative times + countdowns
import { ApiError } from "@/lib/api"; // 404 detection
import { errorMessage } from "@/lib/errors"; // friendly text
import { fmtDateTime, fmtRelative } from "@/lib/format"; // formatting
import { qk } from "@/lib/query-keys"; // cache keys
import type { CommandOut, StudentDetail } from "@/lib/types"; // shapes

export default function AdminStudentPage() { // /admin/students/[id] (WP-A4/A5)
  const { id } = useParams<{ id: string }>(); // route parameter
  const studentId = Number(id); // numeric id
  if (!Number.isInteger(studentId) || studentId <= 0) notFound(); // bad URL → 404
  return <StudentView studentId={studentId} />; // page body
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) { // one ruled section
  return (
    <section className="space-y-3 rounded-lg border border-rule bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

type Confirm = // which confirmation is open
  | { kind: "withdraw" } // consent withdrawal (type the number)
  | { kind: "deleteAll" } // all fingerprints
  | { kind: "deleteOne"; deviceId: number; deviceName: string; slot: number } // one terminal
  | { kind: "deactivate" } // student off
  | { kind: "cancel"; command: CommandOut; terminal: string }; // cancel an enrol

const FINAL = new Set(["done", "failed", "expired", "cancelled"]); // statuses that end a command

function StudentView({ studentId }: { studentId: number }) { // split out so hooks run in a fixed order
  const student = useAdminStudent(studentId); // GET (polls every 2 s while commands are open)
  const devices = useAdminDevices(false); // terminal names
  const deviceCmds = useAllDeviceCommands(devices.data); // recent commands per terminal (final results)
  const setConsent = useSetConsent(studentId); // PUT consent
  const deleteFp = useDeleteFingerprints(studentId); // DELETE fingerprints
  const update = useUpdateStudent(studentId); // PATCH (deactivate / reactivate)
  const cancel = useCancelCommand(); // POST cancel
  const queryClient = useQueryClient(); // cache
  const now = useNow(1000); // countdowns tick every second
  const [confirm, setConfirm] = useState<Confirm | null>(null); // open confirmation
  const [enrolOpen, setEnrolOpen] = useState(false); // enrol dialog
  const [editOpen, setEditOpen] = useState(false); // edit dialog
  const [consentOpen, setConsentOpen] = useState(false); // record-consent dialog
  const [tracked, setTracked] = useState<number[]>([]); // command ids seen open during this page visit

  const s = student.data; // shorthand
  const openIds = useMemo(() => (s?.open_commands ?? []).map((c) => c.id), [s]); // open command ids
  const newIds = openIds.filter((id) => !tracked.includes(id)); // newly seen
  if (newIds.length > 0) setTracked([...tracked, ...newIds]); // derived-state update: remember them

  const deviceNames = useMemo(() => new Map((devices.data ?? []).map((d) => [d.id, d.name])), [devices.data]); // id → name
  const recent = useMemo(() => new Map(deviceCmds.flatMap((q) => q.data?.items ?? []).map((c) => [c.id, c])), [deviceCmds]); // id → latest copy from the terminals' histories
  const finished = tracked.filter((id) => !openIds.includes(id)).map((id) => recent.get(id)).filter((c): c is CommandOut => !!c && FINAL.has(c.status)).slice(-5).reverse(); // last 5 finished (spec §5.2)
  const awaitingResult = tracked.some((id) => !openIds.includes(id) && !(recent.get(id) && FINAL.has(recent.get(id)!.status))); // left the open list but no final copy yet

  useEffect(() => { // fetch the final status of commands that just finished
    if (awaitingResult) queryClient.invalidateQueries({ queryKey: qk.adminDeviceCommandsAll }); // refresh terminal histories
  }, [awaitingResult, student.dataUpdatedAt, queryClient]); // after each student poll

  if (student.error instanceof ApiError && student.error.status === 404) { // unknown student
    return <EmptyState icon={UserRound} title="Student not found" action={<Button asChild variant="outline"><Link href="/admin/students">Back to Students</Link></Button>} />; // dead end with a way back
  }
  if (student.isError) return <p role="alert" className="text-sm text-danger">{errorMessage(student.error)}</p>; // other errors
  if (!s) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-48 rounded-lg" /></div>; // loading

  const enrolBlocker = !s.is_active ? "This student is deactivated. Reactivate them first." : !s.biometric_consent ? "Record consent first" : null; // why Enrol is disabled

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader
        breadcrumb={
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/admin/students" className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">Students</Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span aria-current="page" className="tabular font-mono text-ink-2">{s.student_number}</span>
          </nav>
        }
        title={s.full_name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="tabular font-mono">{s.student_number}</span><ActiveBadge active={s.is_active} /><ConsentBadge consent={s.biometric_consent} consentAt={s.consent_at} /></span>}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="size-4" aria-hidden />Edit name</Button>
            {s.is_active
              ? <Button variant="outline" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: "deactivate" })}><Ban className="size-4" aria-hidden />Deactivate</Button>
              : <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ is_active: true })}><RotateCcw className="size-4" aria-hidden />Reactivate</Button>}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {/* Card 1 — consent */}
          <Card
            title="Biometric consent (POPIA)"
            action={s.biometric_consent
              ? <Button variant="outline" className="border-danger/50 text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: "withdraw" })}><ShieldOff className="size-4" aria-hidden />Withdraw consent</Button>
              : <Button disabled={!s.is_active} onClick={() => setConsentOpen(true)}><ShieldCheck className="size-4" aria-hidden />Record consent</Button>}
          >
            <p className="text-sm font-medium text-ink">{s.biometric_consent && s.consent_at ? `Consent given on ${fmtDateTime(s.consent_at)}` : "No consent recorded"}</p>
            <p className="flex items-start gap-2 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />Students who don’t consent can always be marked present manually by their lecturer.</p>
          </Card>

          {/* Card 2 — fingerprints */}
          <Card
            title="Fingerprints"
            action={
              <div className="flex flex-wrap gap-2">
                {enrolBlocker ? (
                  // disabled button inside a focusable wrapper so the tooltip still works
                  <Tooltip>
                    <TooltipTrigger asChild><span tabIndex={0} className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"><Button size="sm" disabled><Fingerprint className="size-3.5" aria-hidden />Enrol on a terminal</Button></span></TooltipTrigger>
                    <TooltipContent>{enrolBlocker}</TooltipContent>
                  </Tooltip>
                ) : <Button size="sm" onClick={() => setEnrolOpen(true)}><Fingerprint className="size-3.5" aria-hidden />Enrol on a terminal</Button>}
                {s.fingerprint_slots.length > 0 && <Button size="sm" variant="outline" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: "deleteAll" })}><Trash2 className="size-3.5" aria-hidden />Delete all fingerprints</Button>}
              </div>
            }
          >
            {s.fingerprint_slots.length === 0 ? <p className="text-sm text-muted-foreground">No fingerprint stored on any terminal.</p> : (
              <div className="overflow-x-auto rounded-md border border-rule">
                <Table className="min-w-[24rem]">
                  <TableCaption className="sr-only">Terminals holding this student’s fingerprint</TableCaption>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Terminal</TableHead><TableHead>Slot</TableHead><TableHead className="text-right"><span className="sr-only">Delete</span></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {s.fingerprint_slots.map((slot) => ( // one row per terminal
                      <TableRow key={slot.device_id}>
                        <TableCell className="font-medium text-ink">{slot.device_name}</TableCell>
                        <TableCell className="tabular font-mono text-sm">#{slot.slot_number}</TableCell>
                        <TableCell className="text-right"><Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: "deleteOne", deviceId: slot.device_id, deviceName: slot.device_name, slot: slot.slot_number })}><Trash2 className="size-3.5" aria-hidden />Delete</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          {/* Card 3 — terminal activity */}
          <Card title="Terminal activity">
            {s.open_commands.length === 0 && finished.length === 0 && <p className="text-sm text-muted-foreground">No pending terminal activity.</p>}
            <ul className="space-y-2">
              {[...s.open_commands, ...finished].map((c) => <CommandRow key={c.id} command={c} terminal={deviceNames.get(c.device_id) ?? `terminal #${c.device_id}`} now={now} onCancel={(cmd, terminal) => setConfirm({ kind: "cancel", command: cmd, terminal })} />)}
            </ul>
          </Card>
        </div>

        {/* Card 4 — courses */}
        <div className="space-y-6">
          <Card title="Courses">
            {s.courses.length === 0 ? <p className="text-sm text-muted-foreground">Not on any class list. Add the student from a course page.</p> : (
              <div className="flex flex-wrap gap-2">
                {s.courses.map((c) => <Link key={c.id} href={`/admin/courses/${c.id}`} className="inline-flex h-8 items-center gap-2 rounded-md border border-rule px-2.5 text-sm outline-none hover:border-cobalt/60 focus-visible:outline-2 focus-visible:outline-ring"><span className="font-display font-bold text-ink">{c.code}</span><span className="text-ink-2">{c.name}</span></Link>)}
              </div>
            )}
          </Card>
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />Fingerprint templates never leave the terminal’s sensor. This page only shows which slot holds them.</p>
        </div>
      </div>

      {/* dialogs */}
      <ConfirmDialogs student={s} confirm={confirm} onClose={() => setConfirm(null)} setConsent={(v) => setConsent.mutateAsync(v)} deleteFp={(d) => deleteFp.mutateAsync(d)} deactivate={() => update.mutateAsync({ is_active: false })} cancelCommand={(id) => cancel.mutateAsync(id)} />
      <EnrolDialog student={s} open={enrolOpen} onOpenChange={setEnrolOpen} />
      <EditStudentDialog student={s} open={editOpen} onOpenChange={setEditOpen} />
      <RecordConsentDialog studentId={s.id} studentName={s.full_name} open={consentOpen} onOpenChange={setConsentOpen} />
    </div>
  );
}

function CommandRow({ command: c, terminal, now, onCancel }: { command: CommandOut; terminal: string; now: number; onCancel: (c: CommandOut, terminal: string) => void }) { // one command in Card 3
  const open = c.status === "pending" || c.status === "in_progress"; // still running?
  return (
    <li className="space-y-1.5 rounded-md border border-rule px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><CommandTypeLabel type={c.type} /><span className="text-sm text-muted-foreground">· {terminal} · slot {c.slot_number}</span></span>
        <CommandStatusBadge status={c.status} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tabular font-mono text-xs text-muted-foreground">
          queued {fmtRelative(c.created_at, now)}{open && c.type === "enrol" && c.expires_at ? ` · expires in ${countdown(c.expires_at, now)}` : ""}{c.result_detail ? ` · ${c.result_detail}` : ""}
        </p>
        {/* enrol commands can be cancelled; wipes can't (POPIA) */}
        {open && c.type === "enrol" && <Button variant="ghost" size="sm" onClick={() => onCancel(c, terminal)}><Ban className="size-3.5" aria-hidden />Cancel</Button>}
        {open && c.type === "delete_slot" && (
          <Tooltip>
            <TooltipTrigger asChild><span tabIndex={0} className="rounded text-xs text-muted-foreground underline decoration-dotted focus-visible:outline-2 focus-visible:outline-ring">Can’t be cancelled</span></TooltipTrigger>
            <TooltipContent>Deletions can’t be cancelled</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

interface ConfirmDialogsProps { // all the confirmations for this page
  student: StudentDetail; // who
  confirm: Confirm | null; // which one is open
  onClose: () => void; // close it
  setConsent: (v: boolean) => Promise<unknown>; // PUT consent
  deleteFp: (deviceId: number | null) => Promise<unknown>; // DELETE fingerprints
  deactivate: () => Promise<unknown>; // PATCH is_active=false
  cancelCommand: (id: number) => Promise<unknown>; // POST cancel
}

function ConfirmDialogs({ student: s, confirm, onClose, setConsent, deleteFp, deactivate, cancelCommand }: ConfirmDialogsProps) { // each says exactly what will happen (admin spec A5)
  const openChange = (o: boolean) => { if (!o) onClose(); }; // close handler
  return (
    <>
      <ConfirmDialog
        open={confirm?.kind === "withdraw"}
        onOpenChange={openChange}
        title="Withdraw biometric consent?"
        description={<p>This deletes {s.full_name}’s fingerprint from every terminal and stops biometric attendance. They can still be marked present manually by a lecturer. This is recorded in the audit log.</p>}
        confirmLabel="Withdraw consent"
        destructive
        requireText={s.student_number}
        onConfirm={() => setConsent(false)}
      />
      <ConfirmDialog
        open={confirm?.kind === "deleteAll"}
        onOpenChange={openChange}
        title="Delete all fingerprints?"
        description={<p>{s.full_name}’s fingerprint is unlinked immediately, and each terminal wipes its slot next time it checks in. This can’t be cancelled.</p>}
        confirmLabel="Delete all fingerprints"
        destructive
        onConfirm={() => deleteFp(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "deleteOne"}
        onOpenChange={openChange}
        title={confirm?.kind === "deleteOne" ? `Delete the fingerprint on ${confirm.deviceName}?` : "Delete fingerprint?"}
        description={<p>{confirm?.kind === "deleteOne" ? `${confirm.deviceName} will wipe slot ${confirm.slot} next time it checks in. ` : ""}{s.full_name} can no longer sign in with their finger on that terminal.</p>}
        confirmLabel="Delete fingerprint"
        destructive
        onConfirm={() => deleteFp(confirm?.kind === "deleteOne" ? confirm.deviceId : null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "deactivate"}
        onOpenChange={openChange}
        title={`Deactivate ${s.full_name}?`}
        description={<p>Deactivating removes {s.full_name} from attendance and deletes their fingerprints from all terminals. Their past attendance records are kept.</p>}
        confirmLabel="Deactivate"
        destructive
        onConfirm={deactivate}
      />
      <ConfirmDialog
        open={confirm?.kind === "cancel"}
        onOpenChange={openChange}
        title="Cancel this enrolment?"
        description={<p>{confirm?.kind === "cancel" ? `${confirm.terminal} won’t ask for the finger. If it already started, the slot is wiped.` : ""}</p>}
        confirmLabel="Cancel enrolment"
        destructive
        onConfirm={() => cancelCommand(confirm?.kind === "cancel" ? confirm.command.id : 0)}
      />
    </>
  );
}
