"use client"; // FACE: admin face enrol / verify card for the student page

import { useState } from "react"; // local state
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"; // data fetching
import { ScanFace, Trash2 } from "lucide-react"; // icons
import { toast } from "sonner"; // feedback
import { Button } from "@/components/ui/button"; // actions
import { useAdminDevices } from "@/hooks/use-admin"; // terminal list
import { apiFetch } from "@/lib/api"; // HTTP layer
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly error text
import { fmtDateTime } from "@/lib/format"; // dates
import type { CommandOut, StudentDetail } from "@/lib/types"; // shapes

interface FaceStatus { enrolled: boolean; enrolled_at: string | null; } // GET /admin/students/{id}/face

export function FaceCard({ student }: { student: StudentDetail }) { // face card: status + enrol/verify/delete
  const token = useToken(); // auth
  const qc = useQueryClient(); // refresh other cards after an action
  const devices = useAdminDevices(10_000); // terminals (online dots)
  const active = (devices.data ?? []).filter((d) => d.is_active); // only usable terminals
  const [deviceId, setDeviceId] = useState<number | null>(null); // chosen terminal
  const chosen = deviceId ?? active[0]?.id ?? null; // default: first terminal
  const status = useQuery({ // is a face enrolled?
    queryKey: ["admin", "face", student.id], // cache key
    queryFn: ({ signal }) => apiFetch<FaceStatus>(`/admin/students/${student.id}/face`, { token, signal }), // request
    enabled: !!token, // wait for login
    refetchInterval: 4000, // turns "Enrolled" soon after the terminal finishes
  });
  const queue = useMutation({ // POST enrol / verify
    mutationFn: (kind: "enrol" | "verify") => apiFetch<CommandOut>(`/admin/students/${student.id}/face/${kind}`, { method: "POST", body: { device_id: chosen }, token }), // request
    onSuccess: (_cmd, kind) => { // queued
      const name = active.find((d) => d.id === chosen)?.name ?? "the terminal"; // terminal name
      toast.success(`${kind === "enrol" ? "Face enrolment" : "Face check"} sent. Ask ${student.full_name} to look at the camera on ${name}.`); // instruction
      qc.invalidateQueries(); // terminal activity card picks it up
    },
    onError: (err) => toast.error(errorMessage(err)), // friendly error
  });
  const remove = useMutation({ // DELETE face template
    mutationFn: () => apiFetch<void>(`/admin/students/${student.id}/face`, { method: "DELETE", token }), // request
    onSuccess: () => { toast.success("Face template deleted."); qc.invalidateQueries(); }, // done
    onError: (err) => toast.error(errorMessage(err)), // friendly error
  });
  const blocker = !student.is_active ? "This student is deactivated." : !student.biometric_consent ? "Record consent first." : active.length === 0 ? "No active terminal." : null; // why buttons are disabled
  const enrolled = status.data?.enrolled ?? false; // template exists?
  return (
    // ruled section, same look as the other cards on this page
    <section className="space-y-3 rounded-lg border border-rule bg-surface p-4 md:p-5">
      {/* title row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Face (backup to fingerprint)</h2>
        <span className="text-sm text-muted-foreground">{status.isLoading ? "Checking…" : enrolled ? `Enrolled${status.data?.enrolled_at ? ` on ${fmtDateTime(status.data.enrolled_at)}` : ""}` : "Not enrolled"}</span>
      </div>
      {/* terminal picker + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="face-terminal">Terminal</label>
        <select id="face-terminal" className="h-9 rounded-md border border-rule bg-surface px-2 text-sm" value={chosen ?? ""} onChange={(e) => setDeviceId(Number(e.target.value))} disabled={active.length === 0}>
          {active.map((d) => <option key={d.id} value={d.id}>{d.name}{d.online ? "" : " (offline)"}</option>)}
        </select>
        <Button size="sm" disabled={!!blocker || queue.isPending} onClick={() => queue.mutate("enrol")}><ScanFace className="size-3.5" aria-hidden />{enrolled ? "Re-enrol face" : "Enrol face"}</Button>
        <Button size="sm" variant="outline" disabled={!!blocker || !enrolled || queue.isPending} onClick={() => queue.mutate("verify")}><ScanFace className="size-3.5" aria-hidden />Test face match</Button>
        {enrolled && <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${student.full_name}'s face template?`)) remove.mutate(); }}><Trash2 className="size-3.5" aria-hidden />Delete face</Button>}
      </div>
      {/* help text */}
      <p className="text-sm text-muted-foreground">{blocker ?? "The terminal shows the student's name and counts down from 3. Only 128 numbers describing the face are stored, never the picture. Progress shows under Terminal activity."}</p>
    </section>
  );
}
