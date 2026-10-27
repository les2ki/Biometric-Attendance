"use client"; // form + dialog state

import { useForm } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { LoaderCircle } from "lucide-react"; // spinner
import { Button } from "@/components/ui/button"; // actions
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"; // confirm modal
import { Textarea } from "@/components/ui/textarea"; // reason
import { FormField } from "@/components/form-field"; // label + message
import { useRevoke } from "@/hooks/use-lecturer"; // POST /revoke
import type { RosterEntry } from "@/lib/types"; // the row being revoked

const schema = z.object({ reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(255, "Keep the reason to 255 characters or fewer.") }); // 3–255
type RevokeValues = z.infer<typeof schema>; // { reason }

interface RevokeDialogProps { sessionId: number; entry: RosterEntry | null; onOpenChange: (open: boolean) => void; } // open while entry is set

export function RevokeDialog({ sessionId, entry, onOpenChange }: RevokeDialogProps) { // "Revoke attendance for X?" (spec §6.4)
  return (
    <AlertDialog open={!!entry} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        {/* question + consequence */}
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Revoke attendance for {entry?.full_name}?</AlertDialogTitle>
          <AlertDialogDescription>The record is kept but no longer counts as present. You can reinstate it later.</AlertDialogDescription>
        </AlertDialogHeader>
        {entry && <RevokeForm sessionId={sessionId} entry={entry} onDone={() => onOpenChange(false)} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevokeForm({ sessionId, entry, onDone }: { sessionId: number; entry: RosterEntry; onDone: () => void }) { // reason + confirm
  const revoke = useRevoke(sessionId); // mutation
  const { register, handleSubmit, formState } = useForm<RevokeValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { reason: "" } }); // form state

  const onSubmit = handleSubmit((values) => { // schema passed
    if (entry.attendance_id === null) return; // absent rows have nothing to revoke
    revoke.mutate({ attendanceId: entry.attendance_id, body: { reason: values.reason.trim() } }, { onSuccess: () => onDone() }); // POST, then close
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      {/* required reason */}
      <FormField id="revoke-reason" label="Reason" error={formState.errors.reason?.message} helper="Recorded in the audit log with your name.">
        <Textarea id="revoke-reason" rows={3} maxLength={255} className="min-h-24 resize-y" aria-invalid={!!formState.errors.reason} aria-describedby="revoke-reason-message" {...register("reason")} />
      </FormField>
      {/* cancel / destructive confirm (a real submit button so the dialog stays open while saving) */}
      <AlertDialogFooter className="pt-2">
        <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={revoke.isPending}>
          {revoke.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          Revoke
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
