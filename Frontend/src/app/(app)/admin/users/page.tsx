"use client"; // client-rendered dashboard page (spec U2)

import { useState, type ReactElement } from "react"; // React
import { KeyRound, MoreHorizontal, Power, PowerOff, ShieldCheck, UserPlus, Users } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"; // row actions
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // role filter
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"; // own-row explanation
import { ActiveBadge } from "@/components/admin/active-badge"; // status pill
import { SearchInput } from "@/components/admin/search-input"; // ?q=
import { AddUserDialog, ResetPasswordDialog } from "@/components/admin/user-dialogs"; // forms
import { ConfirmDialog } from "@/components/confirm-dialog"; // confirms
import { DataTable, type Column } from "@/components/data-table"; // table
import { EmptyState } from "@/components/empty-state"; // no results
import { PageHeader } from "@/components/page-header"; // title row
import { PaginationBar } from "@/components/pagination-bar"; // paging
import { RoleBadge } from "@/components/role-badge"; // admin / lecturer
import { ADMIN_PAGE_SIZE, useAdminUsers, useUpdateUser } from "@/hooks/use-admin"; // data
import { useQueryState } from "@/hooks/use-query-state"; // URL filters
import { useAuth } from "@/lib/auth"; // who am I
import { errorMessage } from "@/lib/errors"; // friendly text
import { fmtDate } from "@/lib/format"; // created date
import type { Role, UserOut } from "@/lib/types"; // shapes

type Confirm = { kind: "role" | "active"; user: UserOut }; // which confirmation is open
const SELF_HINT = "You can’t change your own role or deactivate yourself."; // own-row tooltip (spec §8.1)

export default function AdminUsersPage() { // /admin/users (WP-A8)
  const { user: me } = useAuth(); // the signed-in admin
  const { get, getNumber, set } = useQueryState(); // ?q=&role=&offset=
  const q = get("q") ?? ""; // search
  const role = get("role") ?? "all"; // role filter
  const offset = getNumber("offset", 0); // paging
  const users = useAdminUsers({ role: role === "all" ? undefined : (role as Role), search: q || undefined, offset, limit: ADMIN_PAGE_SIZE }); // the list
  const update = useUpdateUser(); // PATCH (backend guards → friendly toasts)
  const [addOpen, setAddOpen] = useState(false); // add dialog
  const [resetFor, setResetFor] = useState<UserOut | null>(null); // reset dialog
  const [confirm, setConfirm] = useState<Confirm | null>(null); // role / active confirm

  const columns: Column<UserOut>[] = [ // spec §8.1 columns
    { key: "name", header: "Name", cell: (u) => <span className="font-medium text-ink">{u.full_name}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}</span>, sortable: (u) => u.full_name }, // name
    { key: "email", header: "Email", cell: (u) => <span className="text-ink-2">{u.email}</span> }, // login
    { key: "role", header: "Role", cell: (u) => <RoleBadge role={u.role} /> }, // badge
    { key: "status", header: "Status", cell: (u) => <ActiveBadge active={u.is_active} /> }, // active
    { key: "created", header: "Created", cell: (u) => <span className="text-sm text-muted-foreground">{fmtDate(u.created_at)}</span> }, // date
    { key: "actions", header: <span className="sr-only">Actions</span>, className: "w-12", cell: (u) => { // actions menu
      const isMe = u.id === me?.id; // own row
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${u.full_name}`}><MoreHorizontal className="size-4" aria-hidden /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate">{u.full_name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <SelfGuard isMe={isMe}><DropdownMenuItem disabled={isMe} onSelect={() => setConfirm({ kind: "role", user: u })}><ShieldCheck className="size-4" aria-hidden />{u.role === "admin" ? "Change to lecturer…" : "Change to administrator…"}</DropdownMenuItem></SelfGuard>
            <SelfGuard isMe={isMe}><DropdownMenuItem disabled={isMe} onSelect={() => setConfirm({ kind: "active", user: u })}>{u.is_active ? <PowerOff className="size-4" aria-hidden /> : <Power className="size-4" aria-hidden />}{u.is_active ? "Deactivate…" : "Activate…"}</DropdownMenuItem></SelfGuard>
            <DropdownMenuItem onSelect={() => setResetFor(u)}><KeyRound className="size-4" aria-hidden />Reset password…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    } },
  ];

  const target = confirm?.user; // shorthand for the dialogs

  return (
    <div className="space-y-6">
      {/* header */}
      <PageHeader title="Staff accounts" subtitle="Administrators and lecturers. Students never log in." actions={<Button size="lg" onClick={() => setAddOpen(true)}><UserPlus className="size-4" aria-hidden />Add staff account</Button>} />

      {/* toolbar */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SearchInput label="Search by name or email" placeholder="Name or email" />
        <Select value={role} onValueChange={(v) => set({ role: v === "all" ? null : v })}>
          <SelectTrigger className="h-10 w-full" aria-label="Filter by role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="admin">Administrators</SelectItem>
            <SelectItem value="lecturer">Lecturers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {users.isError && <p role="alert" className="text-sm text-danger">{errorMessage(users.error)}</p>}
      <DataTable caption="Staff accounts" columns={columns} rows={users.data?.items} rowKey={(u) => u.id} loading={users.isPending} minWidth="48rem" empty={<EmptyState icon={Users} title="No accounts match" description="Try a different search or role." />} />
      {users.data && users.data.total > 0 && <PaginationBar total={users.data.total} limit={ADMIN_PAGE_SIZE} offset={offset} onChange={(o) => set({ offset: o || null }, { resetOffset: false })} />}

      {/* dialogs */}
      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
      <ConfirmDialog
        open={confirm?.kind === "role"}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={target?.role === "admin" ? `Make ${target?.full_name} a lecturer?` : `Make ${target?.full_name ?? ""} an administrator?`}
        description={<p>{target?.role === "admin" ? "They lose access to the admin area immediately. Their course assignments stay as they are." : "They get full access to students, consent, terminals, staff accounts and the audit log."}</p>}
        confirmLabel="Change role"
        onConfirm={() => update.mutateAsync({ id: target?.id ?? 0, body: { role: target?.role === "admin" ? "lecturer" : "admin" } })}
      />
      <ConfirmDialog
        open={confirm?.kind === "active"}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={target?.is_active ? `Deactivate ${target?.full_name}?` : `Activate ${target?.full_name ?? ""}?`}
        description={<p>{target?.is_active ? "They are signed out on their next request and can’t sign in again until reactivated. Their past actions stay in the audit log." : "They can sign in again with their existing password."}</p>}
        confirmLabel={target?.is_active ? "Deactivate" : "Activate"}
        destructive={!!target?.is_active}
        onConfirm={() => update.mutateAsync({ id: target?.id ?? 0, body: { is_active: !target?.is_active } })}
      />
    </div>
  );
}

function SelfGuard({ isMe, children }: { isMe: boolean; children: ReactElement }) { // wraps own-row items with an explanation
  if (!isMe) return children; // nothing to explain
  return (
    <Tooltip>
      <TooltipTrigger asChild><div>{children}</div></TooltipTrigger>
      <TooltipContent side="left">{SELF_HINT}</TooltipContent>
    </Tooltip>
  );
}
