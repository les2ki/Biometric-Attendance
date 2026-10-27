import { cn } from "@/lib/utils"; // class merging

type DeviceState = "online" | "offline" | "busy"; // what a terminal can be

const STATES: Record<DeviceState, { label: string; dot: string; text: string }> = { // dot colour + label
  online: { label: "Online", dot: "bg-present", text: "text-present" }, // green dot
  offline: { label: "Offline", dot: "bg-muted-foreground/60", text: "text-muted-foreground" }, // grey dot
  busy: { label: "In use", dot: "bg-revoked", text: "text-revoked" }, // amber dot
};

export function deviceState(device: { online: boolean; busy?: boolean }): DeviceState { // busy beats online/offline
  if (device.busy) return "busy"; // has an open session
  return device.online ? "online" : "offline"; // seen recently or not
}

export function DeviceBadge({ state, className }: { state: DeviceState; className?: string }) { // dot + word
  const s = STATES[state]; // pick the look
  return (
    // dot + label (the label carries the meaning; the dot is decoration)
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", s.text, className)}>
      <span className={cn("size-2 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}
