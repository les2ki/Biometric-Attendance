"use client"; // dialog state

import { useState, type ReactNode } from "react"; // React
import { LoaderCircle } from "lucide-react"; // spinner
import { Button } from "@/components/ui/button"; // confirm
import { Input } from "@/components/ui/input"; // type-to-confirm box
import { Label } from "@/components/ui/label"; // its label
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"; // modal

interface ConfirmDialogProps { // a yes/no question for destructive or privacy-sensitive actions (admin spec A5)
  open: boolean; // visible?
  onOpenChange: (open: boolean) => void; // open/close
  title: string; // the question
  description: ReactNode; // exactly what will happen
  confirmLabel: string; // verb for the action, e.g. "Withdraw consent"
  destructive?: boolean; // red confirm button
  requireText?: string; // the user must type this (e.g. the student number) to enable confirm
  onConfirm: () => Promise<unknown>; // run the action; the dialog closes when it resolves, stays open if it throws
}

export function ConfirmDialog({ open, onOpenChange, ...rest }: ConfirmDialogProps) { // reusable confirm
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        {/* body mounts fresh each time, so the typed text and spinner reset */}
        {open && <ConfirmBody onOpenChange={onOpenChange} {...rest} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmBody({ onOpenChange, title, description, confirmLabel, destructive, requireText, onConfirm }: Omit<ConfirmDialogProps, "open">) { // the dialog contents
  const [typed, setTyped] = useState(""); // type-to-confirm value
  const [pending, setPending] = useState(false); // request in flight
  const matches = !requireText || typed.trim() === requireText; // confirm enabled?

  const confirm = async () => { // run the action
    setPending(true); // spinner
    try { // the action may fail (its hook shows the error toast)
      await onConfirm(); // do it
      onOpenChange(false); // close on success
    } catch { // failed
      /* stay open so the user can retry or cancel */
    } finally { // always
      setPending(false); // stop the spinner
    }
  };

  return (
    <>
      {/* question + consequence */}
      <AlertDialogHeader>
        <AlertDialogTitle className="font-display">{title}</AlertDialogTitle>
        <AlertDialogDescription asChild><div className="space-y-2 text-sm text-muted-foreground">{description}</div></AlertDialogDescription>
      </AlertDialogHeader>
      {/* type-to-confirm (only for the most sensitive actions) */}
      {requireText && (
        <div className="space-y-1.5">
          <Label htmlFor="confirm-text" className="text-sm">Type <span className="font-mono font-semibold text-ink">{requireText}</span> to confirm</Label>
          <Input id="confirm-text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11 font-mono" />
        </div>
      )}
      {/* cancel / confirm (stays open until the request finishes) */}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <Button variant={destructive ? "destructive" : "default"} disabled={pending || !matches} onClick={confirm}>
          {pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
