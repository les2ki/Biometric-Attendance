"use client"; // form + dialog state

import { useForm } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { Info, LoaderCircle } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // student number
import { Textarea } from "@/components/ui/textarea"; // reason
import { FormField } from "@/components/form-field"; // label + message
import { useManualMark } from "@/hooks/use-lecturer"; // POST /manual
import { ApiError } from "@/lib/api"; // error type
import { errorMessage } from "@/lib/errors"; // friendly text

export const QUICK_REASONS = [ // one-tap reasons (spec §6.4)
  "No biometric consent, ID verified", // POPIA fallback
  "Fingerprint not recognised, ID verified", // sensor didn't match
  "Arrived after terminal issue", // terminal was down
  "Correction", // fixing a mistake
];

const STUDENT_FIELD_ERRORS = new Set(["not_in_course", "unknown_student", "already_present", "student_inactive"]); // shown under the student number

const reasonSchema = z.string().trim().min(3, "Give a reason of at least 3 characters.").max(255, "Keep the reason to 255 characters or fewer."); // 3–255 (backend rule)
const freeSchema = z.object({ student_number: z.string().trim().regex(/^\d{6,12}$/, "Student numbers are 6–12 digits."), reason: reasonSchema }); // typed-in number
const prefilledSchema = z.object({ student_number: z.string().min(1), reason: reasonSchema }); // number comes from the roster row
type ManualValues = z.infer<typeof freeSchema>; // { student_number, reason }

export interface MarkTarget { student_number: string; full_name: string; revoked?: boolean; } // prefilled student (from a roster row)

interface ManualMarkDialogProps { // controlled dialog
  sessionId: number; // which session
  sessionClosed: boolean; // closed = late correction
  student: MarkTarget | null; // prefill, or null for a walk-in
  open: boolean; // visible?
  onOpenChange: (open: boolean) => void; // open/close
}

export function ManualMarkDialog({ sessionId, sessionClosed, student, open, onOpenChange }: ManualMarkDialogProps) { // "Mark present" modal
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* title changes for reinstatement */}
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{student?.revoked ? "Reinstate attendance" : "Mark present"}</DialogTitle>
          <DialogDescription>This is recorded with your name and the reason in the audit log.</DialogDescription>
        </DialogHeader>
        {/* form mounts fresh each time the dialog opens */}
        {open && <ManualMarkForm sessionId={sessionId} sessionClosed={sessionClosed} student={student} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ManualMarkForm({ sessionId, sessionClosed, student, onDone }: { sessionId: number; sessionClosed: boolean; student: MarkTarget | null; onDone: () => void }) { // the form inside the dialog
  const mark = useManualMark(sessionId); // mutation
  const { register, handleSubmit, formState, setValue, setError } = useForm<ManualValues>({ // form state
    resolver: zodResolver(student ? prefilledSchema : freeSchema), // stricter rules for typed-in numbers
    mode: "onTouched", // validate after first blur
    defaultValues: { student_number: student?.student_number ?? "", reason: "" }, // prefill from the row
  });

  const onSubmit = handleSubmit((values) => { // schema passed
    mark.mutate({ student_number: values.student_number.trim(), reason: values.reason.trim() }, { // POST /lecturer/sessions/{id}/manual
      onSuccess: () => onDone(), // close; the roster refreshes
      onError: (err) => { // show the problem next to the field too (spec §6.4)
        if (!(err instanceof ApiError)) return; // toast already shown
        if (STUDENT_FIELD_ERRORS.has(err.code)) setError("student_number", { message: errorMessage(err) }); // student problems
        if (err.code === "validation_error" && err.fieldErrors) { // 422
          for (const [field, message] of Object.entries(err.fieldErrors)) { // each bad field
            if (field === "student_number" || field === "reason") setError(field, { message }); // map onto the form
          }
        }
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      {/* closed-session note */}
      {sessionClosed && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-rule bg-paper-2 px-3 py-2 text-sm text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          This session is closed. This will be recorded as a correction.
        </p>
      )}

      {/* student number (read-only when it came from the roster) */}
      <FormField id="student-number" label="Student number" error={formState.errors.student_number?.message} helper={student ? student.full_name : "6–12 digits, e.g. 220000003"}>
        <Input id="student-number" inputMode="numeric" autoComplete="off" readOnly={!!student} className="tabular h-11 font-mono read-only:bg-paper-2" aria-invalid={!!formState.errors.student_number} aria-describedby="student-number-message" {...register("student_number")} />
      </FormField>

      {/* reason + quick picks */}
      <FormField id="reason" label="Reason" error={formState.errors.reason?.message} helper="3–255 characters.">
        <Textarea id="reason" rows={3} maxLength={255} className="min-h-24 resize-y" aria-invalid={!!formState.errors.reason} aria-describedby="reason-message" {...register("reason")} />
      </FormField>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick reasons">
        {QUICK_REASONS.map((text) => ( // one chip per preset
          <button
            key={text}
            type="button"
            onClick={() => setValue("reason", text, { shouldValidate: true, shouldDirty: true })}
            className="h-8 rounded-md border border-rule bg-surface px-2.5 text-xs whitespace-nowrap text-ink-2 outline-none hover:border-cobalt/50 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {text}
          </button>
        ))}
      </div>

      {/* actions */}
      <DialogFooter className="pt-4">
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="lg" disabled={mark.isPending}>
          {mark.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {mark.isPending ? "Saving…" : student?.revoked ? "Reinstate" : "Mark present"}
        </Button>
      </DialogFooter>
    </form>
  );
}
