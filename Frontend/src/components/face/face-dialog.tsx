"use client"; // dialog with live polling of the terminal's camera job
/* Hallmark · component: face-dialog · genre: existing dashboard · theme: existing tokens · states: default hover focus active disabled loading error success */

import { useEffect, useState } from "react"; // React
import { Ban, CircleCheck, CircleX, Hourglass, LoaderCircle, ScanFace, TriangleAlert, UserCheck } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { OnlineDot } from "@/components/admin/online-dot"; // terminal status
import { useAdminDevices, useCancelCommand } from "@/hooks/use-admin"; // terminals + cancel
import { isFinal, useCheckFace, useEnrolFace, useFaceCommand, useFacePreview, useSessionFaceVerify } from "@/hooks/use-face"; // face jobs
import { ApiError } from "@/lib/api"; // error type
import { errorMessage } from "@/lib/errors"; // friendly text
import { firstName } from "@/lib/format"; // "Ask Lee to…"
import type { CommandOut, FaceCommandOut } from "@/lib/types"; // shapes
import { cn } from "@/lib/utils"; // class merging

export type FaceMode = "enrol" | "check" | "verify"; // admin enrol / admin test / lecturer verify (marks present)
export interface FaceStudent { id?: number; full_name: string; student_number: string; } // who is in front of the camera

interface FaceDialogProps { // controlled dialog
  mode: FaceMode; // which flow
  student: FaceStudent | null; // null = closed
  sessionId?: number; // verify: the session to mark
  terminalName?: string; // verify: the session's terminal (no picker)
  onOpenChange: (open: boolean) => void; // open/close
  onManual?: () => void; // verify: "Mark present manually" fallback
  onFinished?: (cmd: FaceCommandOut) => void; // e.g. refresh the roster
}

const TITLES: Record<FaceMode, string> = { enrol: "Enrol face", check: "Test face match", verify: "Verify by face" }; // dialog titles
const FAIL_TEXT: Record<string, string> = { // result_detail → sentence a person can act on
  no_face: "The camera didn’t see a face in any picture. Check the light behind the student and the camera focus, then try again.", // nobody / blurred
  multiple_faces: "More than one person was in view. Ask others to step back, then try again.", // crowd
  face_too_small: "The face was too far from the camera. Ask the student to come closer (about 40 cm), then try again.", // far
  not_enough_samples: "Not enough clear pictures were taken. Try again in better light.", // enrol gave up
  face_not_enrolled: "This student has no face on file any more.", // deleted meanwhile
  consent_withdrawn: "Consent was withdrawn, so the job was stopped.", // POPIA
  cancelled_by_admin: "An administrator cancelled it.", // manual cancel
};

export function FaceDialog({ mode, student, sessionId, terminalName, onOpenChange, onManual, onFinished }: FaceDialogProps) { // the one face dialog used by admin and lecturer pages
  const open = student !== null; // visible?
  const [job, setJob] = useState<CommandOut | null>(null); // queued job (step 2 when set)
  const [done, setDone] = useState(false); // job reached a final status
  const close = () => { setJob(null); setDone(false); onOpenChange(false); }; // reset and close
  const busy = job !== null && !done; // waiting on the terminal

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => { if (busy) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{TITLES[mode]}{student ? ` · ${student.full_name}` : ""}</DialogTitle>
          <DialogDescription className="tabular font-mono">{student?.student_number}</DialogDescription>
        </DialogHeader>
        {open && student && !job && <Start mode={mode} student={student} sessionId={sessionId} terminalName={terminalName} onQueued={setJob} onCancel={close} />}
        {open && student && job && <Progress mode={mode} student={student} job={job} onDone={(cmd) => { setDone(true); onFinished?.(cmd); }} onRetry={() => { setJob(null); setDone(false); }} onClose={close} onManual={onManual ? () => { close(); onManual(); } : undefined} />}
      </DialogContent>
    </Dialog>
  );
}

function Start({ mode, student, sessionId, terminalName, onQueued, onCancel }: { mode: FaceMode; student: FaceStudent; sessionId?: number; terminalName?: string; onQueued: (cmd: CommandOut) => void; onCancel: () => void }) { // step 1: pick terminal (admin) or confirm (lecturer)
  const pickTerminal = mode !== "verify"; // lecturers always use the session's terminal
  const enrol = useEnrolFace(student.id ?? 0); // POST face/enrol
  const check = useCheckFace(student.id ?? 0); // POST face/check
  const verify = useSessionFaceVerify(sessionId ?? 0); // POST face-verify
  const [deviceId, setDeviceId] = useState<number | null>(null); // chosen terminal
  const [error, setError] = useState<string | null>(null); // inline error
  const pending = enrol.isPending || check.isPending || verify.isPending; // request in flight

  const send = async () => { // queue the job
    setError(null); // clear old error
    try { // the request can fail
      const cmd = mode === "verify" ? await verify.mutateAsync(student.student_number) : mode === "enrol" ? await enrol.mutateAsync(deviceId!) : await check.mutateAsync(deviceId!); // POST
      onQueued(cmd); // step 2
    } catch (err) { // camera_busy / no_consent / face_not_enrolled / too_many_attempts / already_present ...
      setError(err instanceof ApiError ? errorMessage(err) : "Something went wrong. Please try again."); // inline
    }
  };

  return (
    <div className="space-y-4">
      {/* what will happen */}
      <ul className="space-y-1.5 rounded-md border border-rule bg-paper-2 px-4 py-3 text-sm text-ink-2">
        <li>{mode === "enrol" ? `The terminal takes 3 pictures of ${firstName(student.full_name)} a few seconds apart.` : `The terminal takes a picture and compares it with ${firstName(student.full_name)}’s stored face.`}</li>
        <li>Face the camera from about 40 cm, one person in view, no strong light behind.</li>
        <li className="text-muted-foreground">Only encrypted face numbers are stored. The picture is shown here once and never saved.</li>
      </ul>

      {/* terminal picker (admin) */}
      {pickTerminal && <TerminalPicker deviceId={deviceId} onChange={setDeviceId} />}
      {!pickTerminal && <p className="text-sm text-ink-2">Uses <span className="font-medium text-ink">{terminalName ?? "this session’s terminal"}</span>. Ask {firstName(student.full_name)} to stand in front of it, then press Start.</p>}

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={send} disabled={pending || (pickTerminal && deviceId === null)}>
          {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ScanFace className="size-4" aria-hidden />}
          {mode === "enrol" ? "Send to terminal" : "Start"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function TerminalPicker({ deviceId, onChange }: { deviceId: number | null; onChange: (id: number) => void }) { // admin-only radio list (its own component so lecturer pages never call /admin/devices)
  const devices = useAdminDevices(10_000); // online dots refresh
  const choices = (devices.data ?? []).filter((d) => d.is_active); // active terminals
  const chosen = choices.find((d) => d.id === deviceId); // selected terminal
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-ink">Terminal with the camera</legend>
      {devices.isPending && <p className="text-sm text-muted-foreground">Loading terminals…</p>}
      {devices.data && choices.length === 0 && <p className="text-sm text-muted-foreground">No active terminals. Add one under Terminals.</p>}
      {choices.map((d) => ( // each terminal
        <label key={d.id} className={cn("flex cursor-pointer items-center gap-3 rounded-md border border-rule px-3 py-3 hover:bg-paper-2", deviceId === d.id && "border-cobalt bg-cobalt-soft")}>
          <input type="radio" name="face-device" value={d.id} checked={deviceId === d.id} onChange={() => onChange(d.id)} className="size-4 accent-(--color-cobalt)" />
          <span className="min-w-0 flex-1"><span className="block font-medium text-ink">{d.name}</span><OnlineDot online={d.online} lastSeenAt={d.last_seen_at} /></span>
        </label>
      ))}
      {chosen && !chosen.online && <p className="flex items-start gap-2 rounded-md border border-revoked-line bg-revoked-soft px-3 py-2 text-sm text-revoked"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />This terminal isn’t online. The job waits 2 minutes for it.</p>}
    </fieldset>
  );
}

function Progress({ mode, student, job, onDone, onRetry, onClose, onManual }: { mode: FaceMode; student: FaceStudent; job: CommandOut; onDone: (cmd: FaceCommandOut) => void; onRetry: () => void; onClose: () => void; onManual?: () => void }) { // step 2: live tracking
  const q = useFaceCommand(job.id); // polls every 1.5 s until final
  const cmd = q.data; // latest copy
  const status = cmd?.status ?? job.status; // assume queued until the first poll
  const finished = isFinal(status); // stop polling / unlock close
  const preview = useFacePreview(job.id, !!cmd?.preview_available, cmd?.frames_received ?? 0); // the picture (refreshes per upload)
  const cancel = useCancelCommand(); // admin only
  const shots = cmd?.shots ?? (mode === "enrol" ? 3 : 1); // dots
  const captured = cmd?.samples_captured ?? 0; // filled dots
  const detail = cmd?.result_detail ?? ""; // outcome code

  useEffect(() => { if (finished && cmd) onDone(cmd); }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps -- fire once when the job ends

  const scoreLine = cmd?.face_score != null ? `similarity ${cmd.face_score.toFixed(2)} · threshold ${cmd.threshold.toFixed(2)}` : null; // honest numbers, no invented percentages
  const success = status === "done" && (detail === "enrolled" || detail === "matched" || detail === "already_present"); // green outcome
  const mismatch = status === "done" && detail === "not_matched"; // red outcome

  return (
    <div className="space-y-4">
      {/* progress dots */}
      <div className="flex items-center gap-3" aria-label={`${captured} of ${shots} pictures`}>
        <span className="flex gap-1.5">{Array.from({ length: shots }, (_, i) => <span key={i} className={cn("size-2.5 rounded-full border", i < captured ? "border-present bg-present" : "border-rule bg-paper-3")} aria-hidden />)}</span>
        <span className="tabular font-mono text-xs text-muted-foreground">{captured} of {shots}{cmd && cmd.frames_received > captured ? ` · ${cmd.frames_received} pictures taken` : ""}</span>
      </div>

      {/* the picture (plain bordered frame, fixed ratio so nothing jumps) */}
      <figure className="space-y-1.5">
        <div className="relative aspect-[4/3] w-full max-w-[480px] overflow-hidden rounded-md border border-rule bg-paper-2">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL from memory, not an optimisable asset
            <img src={preview} alt={`Latest camera picture of ${student.full_name}`} className="size-full object-contain" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"><ScanFace className="mr-2 size-5" aria-hidden />No picture yet</span>
          )}
        </div>
        <figcaption className="text-xs text-muted-foreground">Latest picture from the terminal. Kept in server memory for 2 minutes only, never saved.</figcaption>
      </figure>

      {/* status line */}
      <div aria-live="polite" className="min-h-16 rounded-md border border-rule bg-paper-2 px-4 py-3 text-sm text-ink-2">
        {status === "pending" && <p className="flex items-start gap-2"><LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-cobalt motion-reduce:animate-none" aria-hidden />Waiting for the terminal to pick this up (it checks every few seconds)…</p>}
        {status === "in_progress" && <p className="flex items-start gap-2"><ScanFace className="mt-0.5 size-4 shrink-0 text-cobalt" aria-hidden />Ask {firstName(student.full_name)} to look at the camera. The terminal screen says what to do.</p>}
        {success && <p className="flex items-start gap-2 font-medium text-present"><CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />{detail === "enrolled" ? `Face enrolled · ${shots} samples` : detail === "already_present" ? "Already marked present" : mode === "verify" ? "Verified · marked present (face)" : "Face matched"}</p>}
        {mismatch && <p className="flex items-start gap-2 font-medium text-danger"><CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />Face didn’t match.</p>}
        {status === "done" && detail === "session_closed" && <p className="flex items-start gap-2 text-revoked"><Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />The session closed before the check finished. Nothing was recorded.</p>}
        {status === "failed" && <p className="flex items-start gap-2 text-danger"><CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />{FAIL_TEXT[detail] ?? `The terminal reported a problem: ${detail || "no details given"}.`}</p>}
        {status === "expired" && <p className="flex items-start gap-2 text-revoked"><Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />The terminal didn’t finish within 2 minutes. Is it online?</p>}
        {status === "cancelled" && <p className="flex items-start gap-2 text-muted-foreground"><Ban className="mt-0.5 size-4 shrink-0" aria-hidden />Cancelled. {FAIL_TEXT[detail] ?? ""}</p>}
        {scoreLine && <p className="tabular mt-1.5 font-mono text-xs text-muted-foreground">{scoreLine}</p>}
      </div>

      {/* actions */}
      <DialogFooter className="items-center gap-2 sm:justify-between">
        {!finished && mode !== "verify" ? <Button variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}><Ban className="size-4" aria-hidden />Cancel job</Button> : <span />}
        <div className="flex flex-wrap justify-end gap-2">
          {!finished && <Button variant="outline" onClick={onClose}>Close</Button>}
          {finished && !success && onManual && <Button variant="outline" onClick={onManual}><UserCheck className="size-4" aria-hidden />Mark present manually</Button>}
          {finished && !success && <Button variant={onManual ? "outline" : "default"} onClick={onRetry}>Try again</Button>}
          {finished && success && <Button onClick={onClose}>Done</Button>}
          {finished && !success && !onManual && <Button variant="ghost" onClick={onClose}>Close</Button>}
        </div>
      </DialogFooter>
    </div>
  );
}
