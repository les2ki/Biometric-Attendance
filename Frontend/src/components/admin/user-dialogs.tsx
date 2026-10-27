"use client"; // forms + dialog state

import { useState } from "react"; // React
import { Controller, useForm, useWatch } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { LoaderCircle, Wand2 } from "lucide-react"; // icons
import { useQueryClient } from "@tanstack/react-query"; // refresh after assignments
import { Button } from "@/components/ui/button"; // actions
import { Checkbox } from "@/components/ui/checkbox"; // course picker
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // fields
import { Label } from "@/components/ui/label"; // labels
import { CopyButton } from "@/components/copy-button"; // copy the temporary password
import { FormField } from "@/components/form-field"; // label + message
import { PasswordInput } from "@/components/password-input"; // show/hide
import { useAdminCourses, useCreateUser, useResetPassword } from "@/hooks/use-admin"; // data
import { apiFetch, ApiError } from "@/lib/api"; // course calls + error type
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly text
import { generatePassword } from "@/lib/password"; // random temporary password
import { qk } from "@/lib/query-keys"; // cache keys
import type { CourseDetail, UserOut } from "@/lib/types"; // shapes
import { cn } from "@/lib/utils"; // class merging

const passwordRule = z.string().min(8, "Use at least 8 characters.").max(128, "Keep it under 128 characters."); // backend: ≥ 8

const createSchema = z.object({ // POST /admin/users
  email: z.email("Enter a valid email address, e.g. name@tut.ac.za."), // login name
  full_name: z.string().trim().min(1, "Enter the full name.").max(120, "Keep the name to 120 characters or fewer."), // display name
  role: z.enum(["lecturer", "admin"]), // role
  password: passwordRule, // temporary password
});
type CreateValues = z.infer<typeof createSchema>; // form values

export function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) { // "Add staff account" (admin spec §8.1)
  const [created, setCreated] = useState<UserOut | null>(null); // step 2: assign courses to a new lecturer
  const [wasOpen, setWasOpen] = useState(open); // previous open value
  if (open !== wasOpen) { setWasOpen(open); if (open) setCreated(null); } // reset on open, not on close, so the exit animation doesn't flash step 1
  const close = () => onOpenChange(false); // close (Radix unmounts the body after the animation, so the form starts fresh)
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{created ? "Assign to courses now?" : "Add staff account"}</DialogTitle>
          <DialogDescription>{created ? `${created.full_name} only sees courses they’re assigned to.` : "Share the temporary password with the person securely. They can change it under Account."}</DialogDescription>
        </DialogHeader>
        {!created && <AddUserForm onCancel={close} onCreated={(u) => (u.role === "lecturer" ? setCreated(u) : close())} />}
        {created && <AssignCourses user={created} onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}

function AddUserForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (u: UserOut) => void }) { // step 1: the account
  const create = useCreateUser(); // mutation
  const { register, handleSubmit, formState, setError, setValue, control } = useForm<CreateValues>({ resolver: zodResolver(createSchema), mode: "onTouched", defaultValues: { email: "", full_name: "", role: "lecturer", password: "" } }); // form state
  const password = useWatch({ control, name: "password" }); // live value for the copy button

  const onSubmit = handleSubmit((values) => { // schema passed
    create.mutate({ ...values, email: values.email.trim().toLowerCase(), full_name: values.full_name.trim() }, { // POST
      onSuccess: (u) => onCreated(u), // lecturer → offer course assignment
      onError: (err) => { // inline errors
        if (err instanceof ApiError && err.code === "email_taken") setError("email", { message: errorMessage(err) }); // duplicate
        else if (err instanceof ApiError && err.fieldErrors) { for (const [f, m] of Object.entries(err.fieldErrors)) if (f === "email" || f === "full_name" || f === "password") setError(f, { message: m }); } // 422
        else setError("root", { message: errorMessage(err) }); // anything else
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <FormField id="user-email" label="Email address" error={formState.errors.email?.message}>
        <Input id="user-email" type="email" autoComplete="off" className="h-11" aria-invalid={!!formState.errors.email} aria-describedby="user-email-message" {...register("email")} />
      </FormField>
      <FormField id="user-name" label="Full name" error={formState.errors.full_name?.message}>
        <Input id="user-name" autoComplete="off" className="h-11" aria-invalid={!!formState.errors.full_name} aria-describedby="user-name-message" {...register("full_name")} />
      </FormField>
      {/* role radio (lecturer is the default) */}
      <Controller control={control} name="role" render={({ field }) => (
        <fieldset className="space-y-1.5 pb-2">
          <legend className="pb-1.5 text-sm font-medium text-ink">Role</legend>
          {([["lecturer", "Lecturer", "Runs sessions for assigned courses"], ["admin", "Administrator", "Manages students, courses, terminals and staff"]] as const).map(([value, label, hint]) => ( // two options
            <label key={value} className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2", field.value === value ? "border-cobalt bg-cobalt-soft" : "border-rule hover:bg-paper-2")}>
              <input type="radio" name="user-role" value={value} checked={field.value === value} onChange={() => field.onChange(value)} className="mt-1 size-4 accent-(--color-cobalt)" />
              <span><span className="block text-sm font-medium text-ink">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </fieldset>
      )} />
      <FormField id="user-password" label="Temporary password" error={formState.errors.password?.message} helper="At least 8 characters.">
        <div className="flex gap-2">
          <div className="flex-1"><PasswordInput id="user-password" autoComplete="new-password" className="h-11 font-mono" aria-invalid={!!formState.errors.password} aria-describedby="user-password-message" {...register("password")} /></div>
          <Button type="button" variant="outline" className="h-11" onClick={() => setValue("password", generatePassword(), { shouldValidate: true })}><Wand2 className="size-4" aria-hidden />Generate</Button>
        </div>
      </FormField>
      {password && <div className="flex justify-end"><CopyButton value={password} label="temporary password" /></div>}
      {formState.errors.root && <p role="alert" className="text-sm text-danger">{formState.errors.root.message}</p>}
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Create account</Button>
      </DialogFooter>
    </form>
  );
}

function AssignCourses({ user, onDone }: { user: UserOut; onDone: () => void }) { // step 2: add the new lecturer to courses
  const courses = useAdminCourses(true); // active courses
  const token = useToken(); // auth
  const queryClient = useQueryClient(); // cache
  const [selected, setSelected] = useState<Set<number>>(() => new Set()); // chosen courses
  const [saving, setSaving] = useState(false); // in flight
  const [error, setError] = useState<string | null>(null); // inline error

  const save = async () => { // PUT each course's lecturers with the existing IDs + the new one (spec §8.1)
    setSaving(true); // spinner
    setError(null); // clear
    try { // one course at a time
      for (const courseId of selected) { // each chosen course
        const detail = await apiFetch<CourseDetail>(`/admin/courses/${courseId}`, { token }); // current lecturers first
        const ids = [...new Set([...detail.lecturers.map((u) => u.id), user.id])]; // existing + new
        await apiFetch<CourseDetail>(`/admin/courses/${courseId}/lecturers`, { method: "PUT", body: { user_ids: ids }, token }); // replace the set
      }
      queryClient.invalidateQueries({ queryKey: qk.adminCoursesAll }); // counts changed
      queryClient.invalidateQueries({ queryKey: qk.lecturerCourses }); // lecturer side
      onDone(); // close
    } catch (err) { // e.g. not_a_lecturer
      setError(errorMessage(err)); // inline
    } finally { // always
      setSaving(false); // stop spinner
    }
  };

  return (
    <div className="space-y-3">
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {courses.isPending && <li className="text-sm text-muted-foreground">Loading courses…</li>}
        {(courses.data ?? []).map((c) => ( // one checkbox per course
          <li key={c.id}>
            <Label htmlFor={`assign-${c.id}`} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 font-normal hover:bg-paper-2">
              <Checkbox id={`assign-${c.id}`} checked={selected.has(c.id)} onCheckedChange={(v) => setSelected((prev) => { const next = new Set(prev); if (v === true) next.add(c.id); else next.delete(c.id); return next; })} />
              <span className="text-sm"><span className="font-display font-bold text-ink">{c.code}</span> <span className="text-ink-2">{c.name}</span></span>
            </Label>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Skip</Button>
        <Button disabled={selected.size === 0 || saving} onClick={save}>{saving && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Assign {selected.size > 0 ? selected.size : ""}</Button>
      </DialogFooter>
    </div>
  );
}

const resetSchema = z.object({ new_password: passwordRule }); // POST reset-password
type ResetValues = z.infer<typeof resetSchema>; // form values

export function ResetPasswordDialog({ user, onClose }: { user: UserOut | null; onClose: () => void }) { // admin sets a new password
  return (
    <Dialog open={!!user} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Reset password for {user?.full_name}</DialogTitle>
          <DialogDescription>Their current password stops working immediately.</DialogDescription>
        </DialogHeader>
        {user && <ResetForm user={user} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ResetForm({ user, onDone }: { user: UserOut; onDone: () => void }) { // the form
  const reset = useResetPassword(); // mutation (toast "Password reset")
  const { register, handleSubmit, formState, setValue, control } = useForm<ResetValues>({ resolver: zodResolver(resetSchema), mode: "onTouched", defaultValues: { new_password: "" } }); // form state
  const newPassword = useWatch({ control, name: "new_password" }); // live value for the copy button
  const onSubmit = handleSubmit((values) => reset.mutate({ id: user.id, body: values }, { onSuccess: () => onDone() })); // POST, then close

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <FormField id="reset-password" label="New password" error={formState.errors.new_password?.message} helper="At least 8 characters. Copy it before saving.">
        <div className="flex gap-2">
          <div className="flex-1"><PasswordInput id="reset-password" autoComplete="new-password" className="h-11 font-mono" aria-invalid={!!formState.errors.new_password} aria-describedby="reset-password-message" {...register("new_password")} /></div>
          <Button type="button" variant="outline" className="h-11" onClick={() => setValue("new_password", generatePassword(), { shouldValidate: true })}><Wand2 className="size-4" aria-hidden />Generate</Button>
        </div>
      </FormField>
      {newPassword && <div className="flex justify-end"><CopyButton value={newPassword} label="new password" /></div>}
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={reset.isPending}>{reset.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Reset password</Button>
      </DialogFooter>
    </form>
  );
}
