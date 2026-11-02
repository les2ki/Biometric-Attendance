"use client"; // FACE: lecturer "verify by face" control for the live session page

import { useState } from "react"; // local state
import { useMutation, useQueryClient } from "@tanstack/react-query"; // data fetching
import { ScanFace } from "lucide-react"; // icon
import { toast } from "sonner"; // feedback
import { Button } from "@/components/ui/button"; // action
import { apiFetch } from "@/lib/api"; // HTTP layer
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly error text
import type { CommandOut, RosterEntry } from "@/lib/types"; // shapes

export function FaceVerifyPanel({ sessionId, entries }: { sessionId: number; entries: RosterEntry[] }) { // pick an absent student, verify on the terminal
  const token = useToken(); // auth
  const qc = useQueryClient(); // refresh the roster
  const absent = entries.filter((e) => e.status === "absent"); // only students not yet present
  const [number, setNumber] = useState(""); // chosen student number
  const chosen = number || absent[0]?.student_number || ""; // default: first absent student
  const verify = useMutation({ // POST face-verify
    mutationFn: () => apiFetch<CommandOut>(`/lecturer/sessions/${sessionId}/face-verify`, { method: "POST", body: { student_number: chosen }, token }), // request
    onSuccess: () => { // queued
      const name = absent.find((e) => e.student_number === chosen)?.full_name ?? chosen; // student name
      toast.success(`Ask ${name} to look at the terminal's camera. They turn present here if the face matches.`); // instruction
      qc.invalidateQueries(); // roster refresh
    },
    onError: (err) => toast.error(errorMessage(err)), // friendly error
  });
  if (absent.length === 0) return null; // everyone is present
  return (
    // small ruled bar above the class list
    <section aria-label="Verify by face" className="flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-surface p-3">
      <ScanFace className="size-4 text-muted-foreground" aria-hidden />
      <label htmlFor="face-student" className="text-sm font-medium">Fingerprint not working? Verify by face:</label>
      <select id="face-student" className="h-9 min-w-0 max-w-full rounded-md border border-rule bg-surface px-2 text-sm" value={chosen} onChange={(e) => setNumber(e.target.value)}>
        {absent.map((e) => <option key={e.student_id} value={e.student_number}>{e.full_name} ({e.student_number})</option>)}
      </select>
      <Button size="sm" disabled={!chosen || verify.isPending} onClick={() => verify.mutate()}>Verify by face</Button>
    </section>
  );
}
