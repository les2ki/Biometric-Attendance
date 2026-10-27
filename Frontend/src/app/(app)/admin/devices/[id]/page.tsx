"use client"; // client-rendered dashboard page (spec U2)

import { useState } from "react"; // React
import Link from "next/link"; // navigation
import { notFound, useParams } from "next/navigation"; // route id
import { Ban, ChevronRight, Cpu } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // cancel
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"; // status tabs
import { CommandStatusBadge } from "@/components/admin/command-status-badge"; // status
import { CommandTypeLabel } from "@/components/admin/command-type-label"; // type
import { OnlineDot } from "@/components/admin/online-dot"; // terminal status
import { ConfirmDialog } from "@/components/confirm-dialog"; // cancel confirm
import { DataTable, type Column } from "@/components/data-table"; // table
import { EmptyState } from "@/components/empty-state"; // not found
import { PageHeader } from "@/components/page-header"; // title row
import { PaginationBar } from "@/components/pagination-bar"; // paging
import { useAdminDevices, useCancelCommand, useDeviceCommands } from "@/hooks/use-admin"; // data
import { useQueryState } from "@/hooks/use-query-state"; // ?tab=&offset=
import { fmtDateTime } from "@/lib/format"; // formatting
import type { CommandOut, CommandStatus } from "@/lib/types"; // shapes

const TABS: { value: string; label: string; status?: CommandStatus }[] = [ // spec §7.2 tabs
  { value: "all", label: "All" }, // everything
  { value: "open", label: "Open" }, // pending + in progress (filtered on this page)
  { value: "failed", label: "Failed", status: "failed" }, // server filter
  { value: "done", label: "Done", status: "done" }, // server filter
];
const PAGE = 20; // rows per page

export default function DeviceCommandsPage() { // /admin/devices/[id] — command history (WP-A7)
  const { id } = useParams<{ id: string }>(); // route parameter
  const deviceId = Number(id); // numeric id
  if (!Number.isInteger(deviceId) || deviceId <= 0) notFound(); // bad URL → 404
  return <History deviceId={deviceId} />; // page body
}

function History({ deviceId }: { deviceId: number }) { // split out so hooks run in a fixed order
  const { get, getNumber, set } = useQueryState(); // URL state
  const tab = TABS.find((t) => t.value === get("tab")) ?? TABS[0]; // current tab
  const offset = getNumber("offset", 0); // paging
  const devices = useAdminDevices(10_000); // header info
  const device = devices.data?.find((d) => d.id === deviceId); // this terminal
  const history = useDeviceCommands(deviceId, { status: tab.status, offset: tab.value === "open" ? 0 : offset, limit: tab.value === "open" ? 100 : PAGE }, (open) => (open ? 3000 : false)); // spec §7.2: poll every 3 s while anything is open
  const cancel = useCancelCommand(); // POST cancel
  const [cancelTarget, setCancelTarget] = useState<CommandOut | null>(null); // confirm

  const rows = tab.value === "open" ? history.data?.items.filter((c) => c.status === "pending" || c.status === "in_progress") : history.data?.items; // Open = client-side filter

  if (devices.data && !device) return <EmptyState icon={Cpu} title="Terminal not found" action={<Button asChild variant="outline"><Link href="/admin/devices">Back to Terminals</Link></Button>} />; // unknown id

  const columns: Column<CommandOut>[] = [ // spec §7.2 columns
    { key: "type", header: "Type", cell: (c) => <CommandTypeLabel type={c.type} /> }, // enrol / wipe
    { key: "student", header: "Student", cell: (c) => (c.student_id ? <Link href={`/admin/students/${c.student_id}`} className="tabular rounded font-mono text-sm text-cobalt hover:underline focus-visible:outline-2 focus-visible:outline-ring">{c.student_number}</Link> : <span className="text-sm text-muted-foreground">—</span>) }, // link to the student
    { key: "slot", header: "Slot", cell: (c) => <span className="tabular font-mono text-sm">#{c.slot_number}</span> }, // sensor slot
    { key: "status", header: "Status", cell: (c) => <CommandStatusBadge status={c.status} /> }, // state
    { key: "queued", header: "Queued", cell: (c) => <span className="tabular font-mono text-xs whitespace-nowrap text-ink-2">{fmtDateTime(c.created_at)}</span> }, // when queued
    { key: "completed", header: "Completed", cell: (c) => <span className="tabular font-mono text-xs whitespace-nowrap text-ink-2">{c.completed_at ? fmtDateTime(c.completed_at) : "—"}</span> }, // when finished
    { key: "detail", header: "Detail", cell: (c) => <span className="text-xs text-muted-foreground">{c.result_detail ?? ""}</span> }, // terminal error / cancel reason
    { key: "cancel", header: <span className="sr-only">Cancel</span>, className: "text-right", cell: (c) => (c.type === "enrol" && (c.status === "pending" || c.status === "in_progress") ? <Button variant="ghost" size="sm" onClick={() => setCancelTarget(c)}><Ban className="size-3.5" aria-hidden />Cancel</Button> : null) }, // P2
  ];

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader
        breadcrumb={<nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground"><Link href="/admin/devices" className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">Terminals</Link><ChevronRight className="size-3.5" aria-hidden /><span aria-current="page" className="text-ink-2">{device?.name ?? "…"}</span></nav>}
        title={`${device?.name ?? "Terminal"} · commands`}
        subtitle={device ? <span className="flex flex-wrap items-center gap-3"><OnlineDot online={device.online} lastSeenAt={device.last_seen_at} /><span>{device.enrolled_count} enrolled · {device.pending_commands} waiting</span></span> : undefined}
      />

      {/* status tabs */}
      <Tabs value={tab.value} onValueChange={(v) => set({ tab: v === "all" ? null : v })}>
        <TabsList className="h-10">{TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className="px-3">{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      <DataTable caption={`Commands for ${device?.name ?? "terminal"}`} columns={columns} rows={rows} rowKey={(c) => c.id} loading={history.isPending} minWidth="56rem" empty={<p className="rounded-lg border border-rule bg-surface px-4 py-6 text-sm text-muted-foreground">No commands here.</p>} />
      {tab.value !== "open" && history.data && history.data.total > PAGE && <PaginationBar total={history.data.total} limit={PAGE} offset={offset} onChange={(o) => set({ offset: o || null }, { resetOffset: false })} />}

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Cancel this enrolment?"
        description={<p>{device?.name ?? "The terminal"} won’t ask for {cancelTarget?.student_number ?? "the student"}’s finger. If it already started, the slot is wiped.</p>}
        confirmLabel="Cancel enrolment"
        destructive
        onConfirm={() => cancel.mutateAsync(cancelTarget?.id ?? 0)}
      />
    </div>
  );
}
