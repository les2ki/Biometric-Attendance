"use client"; // checkbox + dialog state

import { useState } from "react"; // React
import { LoaderCircle, ShieldCheck } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Checkbox } from "@/components/ui/checkbox"; // the confirmation tick
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Label } from "@/components/ui/label"; // checkbox label
import { useSetConsent } from "@/hooks/use-admin"; // PUT consent

interface RecordConsentDialogProps { studentId: number; studentName: string; open: boolean; onOpenChange: (open: boolean) => void; } // controlled dialog

export function RecordConsentDialog({ studentId, studentName, open, onOpenChange }: RecordConsentDialogProps) { // "Record consent" (admin spec §5.2)
  const setConsent = useSetConsent(studentId); // mutation
  const [confirmed, setConfirmed] = useState(false); // required tick

  const close = (o: boolean) => { if (!o) setConfirmed(false); onOpenChange(o); }; // reset the tick on close

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Record consent for {studentName}</DialogTitle>
          <DialogDescription>This allows their fingerprint to be enrolled on a terminal. It can be withdrawn at any time.</DialogDescription>
        </DialogHeader>
        {/* required confirmation */}
        <Label htmlFor="consent-confirm" className="flex cursor-pointer items-start gap-3 rounded-md border border-rule px-3 py-3 text-sm font-normal text-ink">
          <Checkbox id="consent-confirm" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
          I confirm the student signed the biometric consent form.
        </Label>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button disabled={!confirmed || setConsent.isPending} onClick={() => setConsent.mutate(true, { onSuccess: () => close(false) })}>
            {setConsent.isPending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
            Record consent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
