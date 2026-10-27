"use client"; // client-rendered dashboard page (spec U2)

import { useForm } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { LoaderCircle } from "lucide-react"; // spinner
import { Button } from "@/components/ui/button"; // submit
import { FormField } from "@/components/form-field"; // label + message
import { PageHeader } from "@/components/page-header"; // title row
import { PasswordInput } from "@/components/password-input"; // show/hide password
import { RoleBadge } from "@/components/role-badge"; // admin / lecturer
import { useChangePassword } from "@/hooks/use-lecturer"; // POST /auth/change-password
import { ApiError } from "@/lib/api"; // error type
import { useAuth } from "@/lib/auth"; // current user
import { errorMessage } from "@/lib/errors"; // friendly text
import { fmtDate } from "@/lib/format"; // "Mon 20 Oct 2026"

const schema = z.object({ // change-password rules (spec §7)
  current_password: z.string().min(1, "Enter your current password."), // required
  new_password: z.string().min(8, "Use at least 8 characters.").max(128, "Keep it under 128 characters."), // backend: ≥ 8
  confirm: z.string().min(1, "Type the new password again."), // required
}).refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The two new passwords don’t match." }); // must match
type PasswordValues = z.infer<typeof schema>; // form values

export default function AccountPage() { // /account (WP7)
  const { user } = useAuth(); // who is signed in
  const change = useChangePassword(); // mutation
  const { register, handleSubmit, formState, setError, reset } = useForm<PasswordValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { current_password: "", new_password: "", confirm: "" } }); // form state

  const onSubmit = handleSubmit((values) => { // schema passed
    change.mutate({ current_password: values.current_password, new_password: values.new_password }, { // POST
      onSuccess: () => reset(), // clear the fields (toast says "Password changed")
      onError: (err) => { // show it next to the right field too
        if (err instanceof ApiError && err.code === "wrong_current_password") setError("current_password", { message: errorMessage(err) }); // inline (spec §7)
        if (err instanceof ApiError && err.fieldErrors?.new_password) setError("new_password", { message: err.fieldErrors.new_password }); // 422
      },
    });
  });

  if (!user) return null; // RequireAuth guarantees a user

  return (
    <div className="space-y-8">
      {/* header */}
      <PageHeader title="Account" subtitle="Your profile and password." />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* profile (read-only) */}
        <section aria-labelledby="profile-heading" className="space-y-4">
          <h2 id="profile-heading" className="text-lg font-semibold">Profile</h2>
          <dl className="divide-y divide-rule rounded-lg border border-rule bg-surface text-sm">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-3"><dt className="text-muted-foreground">Name</dt><dd className="font-medium text-ink">{user.full_name}</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-3"><dt className="text-muted-foreground">Email</dt><dd className="break-all text-ink-2">{user.email}</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-3"><dt className="text-muted-foreground">Role</dt><dd><RoleBadge role={user.role} /></dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-3"><dt className="text-muted-foreground">Member since</dt><dd className="text-ink-2">{fmtDate(user.created_at)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Ask an administrator to change your name, email or role.</p>
        </section>

        {/* change password */}
        <section aria-labelledby="password-heading" className="space-y-4">
          <h2 id="password-heading" className="text-lg font-semibold">Change password</h2>
          <form onSubmit={onSubmit} noValidate className="max-w-md space-y-2">
            <FormField id="current_password" label="Current password" error={formState.errors.current_password?.message}>
              <PasswordInput id="current_password" autoComplete="current-password" className="h-11" aria-invalid={!!formState.errors.current_password} aria-describedby="current_password-message" {...register("current_password")} />
            </FormField>
            <FormField id="new_password" label="New password" error={formState.errors.new_password?.message} helper="At least 8 characters.">
              <PasswordInput id="new_password" autoComplete="new-password" className="h-11" aria-invalid={!!formState.errors.new_password} aria-describedby="new_password-message" {...register("new_password")} />
            </FormField>
            <FormField id="confirm" label="Confirm new password" error={formState.errors.confirm?.message}>
              <PasswordInput id="confirm" autoComplete="new-password" className="h-11" aria-invalid={!!formState.errors.confirm} aria-describedby="confirm-message" {...register("confirm")} />
            </FormField>
            <Button type="submit" size="lg" disabled={change.isPending}>
              {change.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              {change.isPending ? "Saving…" : "Change password"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
