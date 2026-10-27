import { Eraser, Fingerprint } from "lucide-react"; // icons
import type { CommandType } from "@/lib/types"; // enrol | delete_slot

export function commandTypeText(type: CommandType): string { // plain text version
  return type === "enrol" ? "Enrol fingerprint" : "Wipe slot"; // admin spec §3.1
}

export function CommandTypeLabel({ type }: { type: CommandType }) { // icon + label
  const Icon = type === "enrol" ? Fingerprint : Eraser; // pick the icon
  return <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-ink"><Icon className="size-4 text-muted-foreground" aria-hidden />{commandTypeText(type)}</span>; // e.g. "Wipe slot"
}
