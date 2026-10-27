"use client"; // form state + redirects

import { useEffect, useState } from "react"; // React
import { useRouter, useSearchParams } from "next/navigation"; // redirect + ?expired=1
import { useForm } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod → react-hook-form bridge
import { z } from "zod"; // validation schema
import { Clock, LoaderCircle, OctagonAlert } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // submit
import { Input } from "@/components/ui/input"; // email field
import { FormField } from "@/components/form-field"; // label + message wrapper
import { PasswordInput } from "@/components/password-input"; // password with show/hide
import { homeFor, safeNext, useAuth } from "@/lib/auth"; // login() + role routing
import { errorMessage } from "@/lib/errors"; // friendly messages

const schema = z.object({ // what a valid form looks like
  email: z.email("Enter a valid email address, e.g. name@tut.ac.za."), // email format
  password: z.string().min(1, "Enter your password."), // required
});
type LoginValues = z.infer<typeof schema>; // { email: string; password: string }

export function LoginForm() { // the sign-in card (spec §5.2)
  const { login, ready, token, user } = useAuth(); // session
  const router = useRouter(); // redirect helper
  const searchParams = useSearchParams(); // ?expired=1 and ?next=/path
  const expired = searchParams.get("expired") === "1"; // came here because the token ran out
  const next = searchParams.get("next"); // page the user was trying to open
  const [formError, setFormError] = useState<string | null>(null); // inline error above the button
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { email: "", password: "" } }); // validate on blur, then on change

  useEffect(() => { // already signed in → skip the form
    if (ready && token && user) router.replace(safeNext(next, user.role) ?? homeFor(user.role)); // e.g. a bookmark to /login
  }, [ready, token, user, next, router]); // re-check when the session changes

  const onSubmit = handleSubmit(async (values) => { // runs only when the schema passes
    setFormError(null); // clear the previous error
    try { // the request can fail
      const signedIn = await login(values.email.trim(), values.password); // POST /auth/login
      router.replace(safeNext(next, signedIn.role) ?? homeFor(signedIn.role)); // the page they wanted (if allowed), else their home
    } catch (err) { // wrong password, backend down …
      setFormError(errorMessage(err)); // show it inline (not just a toast)
    }
  });

  return (
    // the form card
    <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-5 rounded-xl border border-rule bg-surface p-6 sm:p-8">
      {/* heading */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Biometric Attendance</h1>
        <p className="text-sm text-muted-foreground">Staff sign in</p>
      </div>

      {/* expiry banner (muted, not alarming) */}
      {expired && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-rule bg-paper-2 px-3 py-2 text-sm text-ink-2">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          Your session expired. Please sign in again.
        </p>
      )}

      {/* fields */}
      <div className="space-y-2">
        <FormField id="email" label="Email address" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" inputMode="email" placeholder="name@tut.ac.za" aria-invalid={!!formState.errors.email} aria-describedby="email-message" className="h-11" {...register("email")} />
        </FormField>
        <FormField id="password" label="Password" error={formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} aria-describedby="password-message" className="h-11" {...register("password")} />
        </FormField>
      </div>

      {/* server error, right above the button */}
      {formError && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {formError}
        </p>
      )}

      {/* submit (spinner replaces the icon slot while pending) */}
      <Button type="submit" size="lg" className="h-11 w-full" disabled={formState.isSubmitting}>
        {formState.isSubmitting && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
        {formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>

      {/* footnotes: one sign-in for both roles (admin spec A1); students never log in (spec D1/U7) */}
      <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>Administrators and lecturers use the same sign-in.</p>
        <p>Students don’t need an account. Attendance is captured at the terminal.</p>
      </div>
    </form>
  );
}
