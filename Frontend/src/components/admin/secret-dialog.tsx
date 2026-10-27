"use client"; // dialog state

import { useState } from "react"; // React
import { TriangleAlert } from "lucide-react"; // warning icon
import { Button } from "@/components/ui/button"; // close
import { Checkbox } from "@/components/ui/checkbox"; // "I've saved the secret"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Label } from "@/components/ui/label"; // checkbox label
import { CopyButton } from "@/components/copy-button"; // copy helpers
import type { DeviceCreated } from "@/lib/types"; // device + secret

interface SecretDialogProps { device: DeviceCreated | null; rotated: boolean; onClose: () => void; } // open while device is set; onClose must drop the secret from state

export function SecretDialog({ device, rotated, onClose }: SecretDialogProps) { // DEVICE_ID + HMAC secret, shown ONCE (admin spec A6, §7.1)
  return (
    // can only be closed with the button, after ticking the checkbox (no Escape / outside click / ×)
    <Dialog open={!!device} onOpenChange={() => { /* closing is only allowed via the button */ }}>
      <DialogContent className="sm:max-w-xl" showCloseButton={false} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{rotated ? "New secret for" : "Terminal added:"} {device?.name}</DialogTitle>
          <DialogDescription>Put these two values into the terminal firmware configuration.</DialogDescription>
        </DialogHeader>
        {device && <SecretBody device={device} rotated={rotated} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SecretBody({ device, rotated, onClose }: { device: DeviceCreated; rotated: boolean; onClose: () => void }) { // remounts per device, so the tick resets
  const [saved, setSaved] = useState(false); // "I've saved the secret"
  const config = `DEVICE_ID=${device.id}\nDEVICE_SECRET=${device.hmac_secret}`; // "Copy both as config"

  return (
    <div className="space-y-4">
      {/* warning */}
      <p role="alert" className="flex items-start gap-2 rounded-md border border-revoked-line bg-revoked-soft px-3 py-2 text-sm text-revoked">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        Copy this into the terminal firmware now. For security it will never be shown again.{rotated ? " The old secret has stopped working." : ""}
      </p>
      {/* DEVICE_ID */}
      <div className="space-y-1.5">
        <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">DEVICE_ID</p>
        <div className="flex items-center gap-2">
          <code className="tabular flex-1 rounded-md border border-rule bg-paper-2 px-3 py-2 font-mono text-sm text-ink">{device.id}</code>
          <CopyButton value={String(device.id)} label="device ID" />
        </div>
      </div>
      {/* DEVICE_SECRET */}
      <div className="space-y-1.5">
        <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">DEVICE_SECRET</p>
        <div className="flex items-start gap-2">
          <code className="flex-1 rounded-md border border-rule bg-paper-2 px-3 py-2 font-mono text-sm break-all text-ink">{device.hmac_secret}</code>
          <CopyButton value={device.hmac_secret} label="device secret" />
        </div>
      </div>
      {/* both at once */}
      <CopyButton value={config} label="config" text="Copy both as config" />
      {/* confirmation gate */}
      <Label htmlFor="secret-saved" className="flex cursor-pointer items-center gap-3 rounded-md border border-rule px-3 py-3 text-sm font-normal text-ink">
        <Checkbox id="secret-saved" checked={saved} onCheckedChange={(v) => setSaved(v === true)} />I’ve saved the secret
      </Label>
      <DialogFooter>
        <Button disabled={!saved} onClick={onClose}>Close</Button>
      </DialogFooter>
    </div>
  );
}
