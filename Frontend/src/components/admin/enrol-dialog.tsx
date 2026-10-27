"use client"; // two-step dialog with live polling

import { useEffect, useState } from "react"; // React
import { Check, CircleCheck, CircleX, Fingerprint, Hourglass, LoaderCircle, Ban, TriangleAlert } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { OnlineDot } from "@/components/admin/online-dot"; // terminal status
import { useAdminDevices, useDeviceCommands, useEnrolStudent } from "@/hooks/use-admin"; // data
import { useNow } from "@/hooks/use-now"; // countdown
import { ApiError } from "@/lib/api"; // error type
import { errorMessage } from "@/lib/errors"; // friendly text
import { firstName } from "@/lib/format"; // "Ask Lee to…"
import type { CommandStatus, StudentDetail } from "@/lib/types"; // shapes
import { cn } from "@/lib/utils"; // class merging

const FINAL: CommandStatus[] = ["done", "failed", "expired", "cancelled"]; // statuses that end the flow
const CANCEL_REASONS: Record<string, string> = { // result_detail → sentence
  consent_withdrawn: "Consent was withdrawn before the terminal finished.", // POPIA
  biometrics_deleted: "The student’s fingerprints were deleted while this was waiting.", // deletion won
  cancelled_by_admin: "An administrator cancelled it.", // manual cancel
};

export function countdown(expiresAt: string | null, now: number): string | null { // "8:42" until expiry
  if (!expiresAt) return null; // wipes never expire
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)); // seconds left
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; // m:ss
}

interface EnrolDialogProps { student: StudentDetail; open: boolean; onOpenChange: (open: boolean) => void; } // controlled dialog

export function EnrolDialog({ student, open, onOpenChange }: EnrolDialogProps) { // "Enrol on a terminal" (admin spec §5.3)
  const [tracking, setTracking] = useState<{ commandId: number; deviceId: number } | null>(null); // step 2 when set
  const [final, setFinal] = useState(false); // step 2 reached a final status

  const close = () => { setTracking(null); setFinal(false); onOpenChange(false); }; // reset and close
  const busy = tracking !== null && !final; // in progress → don't close by accident

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy) return; if (!o) close(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy} onInteractOutside={(e) => { if (busy) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Enrol {student.full_name}</DialogTitle>
          <DialogDescription>{tracking ? "Follow the terminal’s progress here. It updates by itself." : "Choose the terminal the student will use."}</DialogDescription>
        </DialogHeader>
        {open && !tracking && <ChooseTerminal student={student} onSent={(commandId, deviceId) => setTracking({ commandId, deviceId })} onCancel={close} />}
        {open && tracking && <LiveProgress student={student} commandId={tracking.commandId} deviceId={tracking.deviceId} onFinal={setFinal} onRetry={() => { setTracking(null); setFinal(false); }} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}

function ChooseTerminal({ student, onSent, onCancel }: { student: StudentDetail; onSent: (commandId: number, deviceId: number) => void; onCancel: () => void }) { // step 1
  const devices = useAdminDevices(10_000); // terminals (online status refreshes)
  const enrol = useEnrolStudent(student.id); // POST /enrol
  const [deviceId, setDeviceId] = useState<number | null>(null); // chosen terminal
  const [error, setError] = useState<string | null>(null); // inline error
  const choices = (devices.data ?? []).filter((d) => d.is_active); // active terminals only
  const chosen = choices.find((d) => d.id === deviceId); // selected terminal

  const reason = (id: number): string | null => { // why a terminal can't be chosen
    if (student.enrolled_device_ids.includes(id)) return "Already enrolled"; // has a slot
    if (student.open_commands.some((c) => c.type === "enrol" && c.device_id === id)) return "Enrolment already waiting"; // pending enrol
    return null; // choosable
  };

  const send = async () => { // queue the enrol command
    if (deviceId === null) return; // nothing chosen
    setError(null); // clear old error
    try { // the request can fail
      const cmd = await enrol.mutateAsync(deviceId); // POST
      onSent(cmd.id, deviceId); // step 2
    } catch (err) { // no_consent / already_enrolled / enrolment_pending / sensor_full / device_inactive
      setError(err instanceof ApiError ? errorMessage(err) : "Something went wrong. Please try again."); // inline (spec §5.3)
    }
  };

  return (
    <div className="space-y-4">
      {/* radio list of terminals */}
      <fieldset className="space-y-2">
        <legend className="sr-only">Terminal</legend>
        {devices.isPending && <p className="text-sm text-muted-foreground">Loading terminals…</p>}
        {devices.data && choices.length === 0 && <p className="text-sm text-muted-foreground">No active terminals. Add one under Terminals.</p>}
        {choices.map((d) => { // each terminal
          const blocked = reason(d.id); // disabled reason
          return (
            <label key={d.id} className={cn("flex items-center gap-3 rounded-md border px-3 py-3", blocked ? "cursor-not-allowed border-rule opacity-60" : "cursor-pointer border-rule hover:bg-paper-2", deviceId === d.id && "border-cobalt bg-cobalt-soft")}>
              <input type="radio" name="enrol-device" value={d.id} checked={deviceId === d.id} disabled={!!blocked} onChange={() => setDeviceId(d.id)} className="size-4 accent-(--color-cobalt)" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{d.name}</span>
                <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"><OnlineDot online={d.online} lastSeenAt={d.last_seen_at} /><span>{d.enrolled_count} enrolled</span></span>
              </span>
              {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
            </label>
          );
        })}
      </fieldset>
      {/* offline warning */}
      {chosen && !chosen.online && (
        <p className="flex items-start gap-2 rounded-md border border-revoked-line bg-revoked-soft px-3 py-2 text-sm text-revoked"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />This terminal isn’t online. The enrolment will wait up to 10 minutes for it to check in.</p>
      )}
      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={send} disabled={deviceId === null || enrol.isPending}>
          {enrol.isPending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Fingerprint className="size-4" aria-hidden />}
          Send to terminal
        </Button>
      </DialogFooter>
    </div>
  );
}

interface LiveProgressProps { student: StudentDetail; commandId: number; deviceId: number; onFinal: (final: boolean) => void; onRetry: () => void; onClose: () => void; } // step 2 inputs

function LiveProgress({ student, commandId, deviceId, onFinal, onRetry, onClose }: LiveProgressProps) { // step 2: live tracking
  const devices = useAdminDevices(false); // terminal name (no extra polling)
  const [isFinal, setIsFinal] = useState(false); // stop polling once finished
  const history = useDeviceCommands(deviceId, { limit: 20 }, isFinal ? false : 2000); // spec §5.3: poll every 2 s until a final status
  const now = useNow(1000); // countdown
  const cmd = history.data?.items.find((c) => c.id === commandId); // our command
  const terminal = devices.data?.find((d) => d.id === deviceId)?.name ?? "the terminal"; // name for the copy
  const status: CommandStatus = cmd?.status ?? "pending"; // assume queued until the first poll
  const done = FINAL.includes(status); // finished?

  if (done !== isFinal) setIsFinal(done); // derived-state update: stop polling once finished

  useEffect(() => { // tell the dialog (a parent) so it unlocks closing — parents can't be updated during render
    onFinal(done); // final → the dialog may close normally
  }, [done, onFinal]); // when the status crosses into final

  const stage = status === "pending" ? 0 : status === "in_progress" ? 1 : 2; // which of the 3 steps is current
  const steps = ["Queued", "On terminal", "Result"]; // the indicator

  return (
    <div className="space-y-5">
      {/* 3-step indicator */}
      <ol className="grid grid-cols-3 gap-2" aria-label="Enrolment progress">
        {steps.map((label, i) => ( // each step
          <li key={label} className="space-y-1.5">
            <span className={cn("block h-1 rounded-full", i < stage ? "bg-present" : i === stage ? (done && status !== "done" ? "bg-revoked" : "bg-cobalt") : "bg-paper-3")} aria-hidden />
            <span className={cn("flex items-center gap-1 text-xs font-medium", i <= stage ? "text-ink" : "text-muted-foreground")} aria-current={i === stage ? "step" : undefined}>
              {i < stage && <Check className="size-3" aria-hidden />}{label}
            </span>
          </li>
        ))}
      </ol>

      {/* the current message */}
      <div aria-live="polite" className="min-h-20 rounded-md border border-rule bg-paper-2 px-4 py-3 text-sm text-ink-2">
        {status === "pending" && <p className="flex items-start gap-2"><LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-cobalt motion-reduce:animate-none" aria-hidden />Waiting for {terminal} to check in…</p>}
        {status === "in_progress" && <p className="flex items-start gap-2"><Fingerprint className="mt-0.5 size-4 shrink-0 text-cobalt" aria-hidden />Ask {firstName(student.full_name)} to place their finger on {terminal} when the screen shows their name.</p>}
        {status === "done" && <p className="flex items-start gap-2 font-medium text-present"><CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />Fingerprint enrolled in slot {cmd?.slot_number}.</p>}
        {status === "failed" && <p className="flex items-start gap-2 text-danger"><CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />The terminal reported a problem: {cmd?.result_detail ?? "no details given"}.</p>}
        {status === "expired" && <p className="flex items-start gap-2 text-revoked"><Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />The terminal didn’t finish in time.</p>}
        {status === "cancelled" && <p className="flex items-start gap-2 text-muted-foreground"><Ban className="mt-0.5 size-4 shrink-0" aria-hidden />Cancelled. {CANCEL_REASONS[cmd?.result_detail ?? ""] ?? cmd?.result_detail ?? ""}</p>}
        {!done && cmd?.expires_at && <p className="tabular mt-2 font-mono text-xs text-muted-foreground">Expires in {countdown(cmd.expires_at, now)}</p>}
      </div>

      {/* actions */}
      <DialogFooter className="items-center sm:justify-between">
        {!done ? (
          <button type="button" onClick={onClose} className="rounded text-sm text-cobalt underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Close, keep waiting in background</button>
        ) : <span />}
        {done && status === "done" && <Button onClick={onClose}>Done</Button>}
        {done && status !== "done" && <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={onRetry}>Try again</Button></div>}
      </DialogFooter>
    </div>
  );
}
