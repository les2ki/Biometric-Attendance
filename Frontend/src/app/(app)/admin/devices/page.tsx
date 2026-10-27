"use client"; // client-rendered dashboard page (spec U2)

import { useState, type FormEvent } from "react"; // React
import Link from "next/link"; // session links
import { useRouter } from "next/navigation"; // row navigation
import { Cpu, KeyRound, ListTree, LoaderCircle, MoreHorizontal, Plus, Power, PowerOff } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // add dialog
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"; // actions menu
import { Input } from "@/components/ui/input"; // name field
import { ActiveBadge } from "@/components/admin/active-badge"; // status pill
import { OnlineDot } from "@/components/admin/online-dot"; // online + last seen
import { SecretDialog } from "@/components/admin/secret-dialog"; // one-time secret
import { ConfirmDialog } from "@/components/confirm-dialog"; // confirms
import { DataTable, type Column } from "@/components/data-table"; // table
import { EmptyState } from "@/components/empty-state"; // no terminals
import { FormField } from "@/components/form-field"; // label + message
import { PageHeader } from "@/components/page-header"; // title row
import { useAdminDevices, useCreateDevice, useRotateSecret, useUpdateDevice } from "@/hooks/use-admin"; // data
import { useNow } from "@/hooks/use-now"; // relative times tick
import { ApiError } from "@/lib/api"; // error type
import { errorMessage } from "@/lib/errors"; // friendly text
import type { DeviceCreated, DeviceOut } from "@/lib/types"; // shapes
import { cn } from "@/lib/utils"; // class merging

type Confirm = { kind: "deactivate" | "rotate"; device: DeviceOut }; // which confirmation is open

export default function AdminDevicesPage() { // /admin/devices (WP-A7)
  const router = useRouter(); // navigation
  const devices = useAdminDevices(10_000); // spec §7.1: poll every 10 s
  const update = useUpdateDevice(); // PATCH is_active
  const rotate = useRotateSecret(); // POST rotate-secret
  const now = useNow(15_000); // "last seen" ticks
  const [addOpen, setAddOpen] = useState(false); // add dialog
  const [secret, setSecret] = useState<{ device: DeviceCreated; rotated: boolean } | null>(null); // the ONLY place the secret lives (cleared on close)
  const [confirm, setConfirm] = useState<Confirm | null>(null); // open confirmation

  const columns: Column<DeviceOut>[] = [ // spec §7.1 columns
    { key: "name", header: "Name", cell: (d) => <span><span className="font-medium text-ink">{d.name}</span><span className="tabular block font-mono text-xs text-muted-foreground">DEVICE_ID {d.id}</span></span>, sortable: (d) => d.name }, // name + id
    { key: "online", header: "Connection", cell: (d) => <OnlineDot online={d.online} lastSeenAt={d.last_seen_at} now={now} /> }, // online / last seen
    { key: "status", header: "Status", cell: (d) => <ActiveBadge active={d.is_active} /> }, // active / inactive
    { key: "session", header: "Session", cell: (d) => (d.open_session_id ? <Link href={`/lecturer/sessions/${d.open_session_id}`} onClick={(e) => e.stopPropagation()} className="rounded text-sm font-medium text-cobalt hover:underline focus-visible:outline-2 focus-visible:outline-ring">Running</Link> : <span className="text-sm text-muted-foreground">—</span>) }, // running session link
    { key: "enrolled", header: "Enrolled", className: "text-right", cell: (d) => <span className="tabular">{d.enrolled_count}</span>, sortable: (d) => d.enrolled_count }, // slots in use
    { key: "waiting", header: "Waiting", className: "text-right", cell: (d) => <span className={cn("tabular", d.pending_commands > 0 && "font-semibold text-cobalt")}>{d.pending_commands}</span>, sortable: (d) => d.pending_commands }, // blue when > 0
    { key: "actions", header: <span className="sr-only">Actions</span>, className: "text-right", cell: (d) => ( // actions menu
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()} aria-label={`Actions for ${d.name}`}><MoreHorizontal className="size-4" aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => router.push(`/admin/devices/${d.id}`)}><ListTree className="size-4" aria-hidden />View commands</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm({ kind: "rotate", device: d })}><KeyRound className="size-4" aria-hidden />Rotate secret…</DropdownMenuItem>
          <DropdownMenuSeparator />
          {d.is_active
            ? <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "deactivate", device: d })}><PowerOff className="size-4" aria-hidden />Deactivate…</DropdownMenuItem>
            : <DropdownMenuItem onSelect={() => update.mutate({ id: d.id, isActive: true })}><Power className="size-4" aria-hidden />Activate</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    ) },
  ];

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader title="Terminals" subtitle="Fingerprint terminals, their secrets and command queues." actions={<Button size="lg" onClick={() => setAddOpen(true)}><Plus className="size-4" aria-hidden />Add terminal</Button>} />

      {devices.isError && <p role="alert" className="text-sm text-danger">{errorMessage(devices.error)}</p>}
      <DataTable
        caption="Terminals"
        columns={columns}
        rows={devices.data}
        rowKey={(d) => d.id}
        loading={devices.isPending}
        onRowClick={(d) => router.push(`/admin/devices/${d.id}`)}
        rowLabel={(d) => `View commands for ${d.name}`}
        minWidth="56rem"
        empty={<EmptyState icon={Cpu} title="No terminals yet" description="Add a terminal to get the DEVICE_ID and secret for its firmware." action={<Button variant="outline" onClick={() => setAddOpen(true)}><Plus className="size-4" aria-hidden />Add terminal</Button>} />}
      />

      {/* add terminal → secret */}
      <AddTerminalDialog open={addOpen} onOpenChange={setAddOpen} onCreated={(device) => setSecret({ device, rotated: false })} />

      {/* confirmations */}
      <ConfirmDialog
        open={confirm?.kind === "deactivate"}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={`Deactivate ${confirm?.device.name ?? ""}?`}
        description={<p>The terminal will be rejected immediately (attendance, enrolment and wipes stop until reactivated). Its stored fingerprint mappings are kept.</p>}
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => update.mutateAsync({ id: confirm?.device.id ?? 0, isActive: false })}
      />
      <ConfirmDialog
        open={confirm?.kind === "rotate"}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={`Rotate the secret for ${confirm?.device.name ?? ""}?`}
        description={<p>The terminal will stop working until you flash the new secret onto it.</p>}
        confirmLabel="Rotate secret"
        destructive
        onConfirm={async () => { const device = await rotate.mutateAsync(confirm?.device.id ?? 0); rotate.reset(); setSecret({ device, rotated: true }); }} // reset: the dialog state is the only copy
      />

      {/* one-time secret (cleared from state when closed) */}
      <SecretDialog device={secret?.device ?? null} rotated={secret?.rotated ?? false} onClose={() => setSecret(null)} />
    </div>
  );
}

function AddTerminalDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (device: DeviceCreated) => void }) { // "Add terminal"
  const create = useCreateDevice(); // POST
  const [name, setName] = useState(""); // field value
  const [error, setError] = useState<string | null>(null); // inline error
  const trimmed = name.trim(); // tidy value

  const submit = (e: FormEvent) => { // create the terminal
    e.preventDefault(); // no page reload
    if (!trimmed || trimmed.length > 50) { setError("Use 1–50 characters, e.g. terminal-02."); return; } // backend rule
    create.mutate(trimmed, { // POST /admin/devices
      onSuccess: (device) => { setName(""); setError(null); onOpenChange(false); onCreated(device); create.reset(); }, // close, show the secret, drop the mutation's copy
      onError: (err) => setError(err instanceof ApiError ? errorMessage(err) : "Something went wrong."), // device_name_taken inline
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setError(null); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Add terminal</DialogTitle>
          <DialogDescription>You’ll see its DEVICE_ID and secret once, right after this step.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-2">
          <FormField id="terminal-name" label="Name" error={error ?? undefined} helper="e.g. terminal-02">
            <Input id="terminal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="off" className="h-11 font-mono" aria-invalid={!!error} aria-describedby="terminal-name-message" />
          </FormField>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Add terminal</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
