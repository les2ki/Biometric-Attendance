"use client"; // dialog state

import { LoaderCircle } from "lucide-react"; // spinner
import { Button } from "@/components/ui/button"; // confirm
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"; // confirm modal
import { useCloseSession } from "@/hooks/use-lecturer"; // POST /close
import type { SessionCounts } from "@/lib/types"; // present / roster

interface CloseSessionDialogProps { sessionId: number; counts: SessionCounts; open: boolean; onOpenChange: (open: boolean) => void; } // controlled dialog

export function CloseSessionDialog({ sessionId, counts, open, onOpenChange }: CloseSessionDialogProps) { // "Close this session?" (spec §6.4)
  const close = useCloseSession(sessionId); // mutation

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        {/* consequence, with the numbers */}
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Close this session?</AlertDialogTitle>
          <AlertDialogDescription>
            The terminal will stop accepting fingerprints for this session. Present: <span className="tabular font-medium text-ink">{counts.present} of {counts.roster}</span>. You can still make corrections afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* cancel / confirm (stays open until the request finishes) */}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={close.isPending} onClick={() => close.mutate(undefined, { onSuccess: () => onOpenChange(false) })}>
            {close.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            Close session
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
