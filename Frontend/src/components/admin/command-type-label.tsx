import { Eraser, Fingerprint, ScanFace } from "lucide-react"; // icons (ScanFace: FACE)
import type { CommandType } from "@/lib/types"; // enrol | delete_slot

export function commandTypeText(type: CommandType): string { // plain text version
  if (type === "face_enrol") return "Enrol face"; // FACE
  if (type === "face_verify") return "Verify face"; // FACE
  return type === "enrol" ? "Enrol fingerprint" : "Wipe slot"; // admin spec §3.1
}

export function CommandTypeLabel({ type }: { type: CommandType }) { // icon + label
  const Icon = type === "face_enrol" || type === "face_verify" ? ScanFace : type === "enrol" ? Fingerprint : Eraser; // pick the icon (ScanFace: FACE)
  return <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-ink"><Icon className="size-4 text-muted-foreground" aria-hidden />{commandTypeText(type)}</span>; // e.g. "Wipe slot"
}
