"use client"; // client-rendered dashboard page (spec U2)

import Link from "next/link"; // target links
import { Lock, ScrollText } from "lucide-react"; // icons
import { Input } from "@/components/ui/input"; // date inputs
import { Label } from "@/components/ui/label"; // labels
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // filters
import { DataTable, type Column } from "@/components/data-table"; // table
import { EmptyState } from "@/components/empty-state"; // no rows
import { JsonView } from "@/components/json-view"; // details
import { PageHeader } from "@/components/page-header"; // title row
import { PaginationBar } from "@/components/pagination-bar"; // paging
import { ADMIN_PAGE_SIZE, useAdminAudit, useAdminUsers } from "@/hooks/use-admin"; // data
import { useQueryState } from "@/hooks/use-query-state"; // URL filters
import { actionLabel, targetHref } from "@/lib/audit-labels"; // human labels + links
import { errorMessage } from "@/lib/errors"; // friendly text
import { fmtDateTime } from "@/lib/format"; // formatting
import type { AuditOut } from "@/lib/types"; // row type

const CATEGORIES: { value: string; label: string; prefix?: string }[] = [ // spec §8.2 categories → action prefix
  { value: "all", label: "All" }, // no filter
  { value: "attendance", label: "Attendance", prefix: "attendance." }, // manual / revoke / export
  { value: "fingerprint", label: "Fingerprints", prefix: "fingerprint." }, // enrol / delete / wipe
  { value: "consent", label: "Consent", prefix: "consent." }, // POPIA
  { value: "session", label: "Sessions", prefix: "session." }, // open / close
  { value: "course", label: "Courses", prefix: "course." }, // courses + rosters
  { value: "student", label: "Students", prefix: "student." }, // student records
  { value: "device", label: "Terminals", prefix: "device." }, // terminals
  { value: "user", label: "Accounts", prefix: "user." }, // staff accounts (kept simple: user.* only)
];
const SAST = "+02:00"; // South Africa has no daylight saving

export default function AuditPage() { // /admin/audit (WP-A9) — read-only: no edit or delete anywhere
  const { get, getNumber, set } = useQueryState(); // ?cat=&actor=&from=&to=&offset=
  const category = CATEGORIES.find((c) => c.value === get("cat")) ?? CATEGORIES[0]; // category
  const actor = get("actor") ?? "all"; // who
  const from = get("from") ?? ""; // yyyy-mm-dd
  const to = get("to") ?? ""; // yyyy-mm-dd
  const offset = getNumber("offset", 0); // paging

  const users = useAdminUsers({ limit: 200 }); // actor options
  const audit = useAdminAudit({ // the log
    action: category.prefix, // prefix match
    actorUserId: actor === "all" ? undefined : Number(actor), // who
    since: from ? `${from}T00:00:00${SAST}` : undefined, // start of day in SAST
    until: to ? `${to}T23:59:59${SAST}` : undefined, // end of day in SAST
    offset, // page
    limit: ADMIN_PAGE_SIZE, // 50
  });

  const columns: Column<AuditOut>[] = [ // spec §8.2 columns
    { key: "time", header: "Time", cell: (a) => <span className="tabular font-mono text-xs whitespace-nowrap text-ink-2">{fmtDateTime(a.created_at)}</span> }, // when
    { key: "actor", header: "Actor", cell: (a) => (a.actor_name ? <span className="text-sm text-ink">{a.actor_name}</span> : <span className="text-sm text-muted-foreground">System / terminal</span>) }, // who
    { key: "action", header: "Action", cell: (a) => <span><span className="block text-sm text-ink">{actionLabel(a.action)}</span><span className="block font-mono text-xs text-muted-foreground">{a.action}</span></span> }, // label + raw code
    { key: "target", header: "Target", cell: (a) => { const href = targetHref(a); const text = `${a.entity} #${a.entity_id}`; return href ? <Link href={href} className="rounded font-mono text-xs text-cobalt hover:underline focus-visible:outline-2 focus-visible:outline-ring">{text}</Link> : <span className="font-mono text-xs text-ink-2">{text}</span>; } }, // linked when it has a page
    { key: "details", header: "Details", cell: (a) => <JsonView value={a.details ?? {}} /> }, // expandable JSON
  ];

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader title="Audit log" subtitle="Every change by staff and terminals, newest first." />

      {/* append-only banner */}
      <p className="flex items-start gap-2 rounded-md border border-rule bg-paper-2 px-3 py-2 text-sm text-ink-2"><Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />The audit log is append-only. Entries can’t be edited or deleted.</p>

      {/* filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="audit-category">Category</Label>
          <Select value={category.value} onValueChange={(v) => set({ cat: v === "all" ? null : v })}>
            <SelectTrigger id="audit-category" className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-actor">Actor</Label>
          <Select value={actor} onValueChange={(v) => set({ actor: v === "all" ? null : v })}>
            <SelectTrigger id="audit-actor" className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {(users.data?.items ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => set({ from: e.target.value })} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value })} className="h-10" />
        </div>
      </div>

      {audit.isError && <p role="alert" className="text-sm text-danger">{errorMessage(audit.error)}</p>}
      <DataTable caption="Audit log entries" columns={columns} rows={audit.data?.items} rowKey={(a) => a.id} loading={audit.isPending} minWidth="56rem" empty={<EmptyState icon={ScrollText} title="No entries match" description="Widen the date range or clear a filter." />} />
      {audit.data && audit.data.total > 0 && <PaginationBar total={audit.data.total} limit={ADMIN_PAGE_SIZE} offset={offset} onChange={(o) => set({ offset: o || null }, { resetOffset: false })} />}
    </div>
  );
}
