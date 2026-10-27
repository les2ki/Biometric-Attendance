import { Suspense } from "react"; // the form reads ?expired=1, which needs a Suspense boundary under Cache Components
import type { Metadata } from "next"; // page title
import { Fingerprint } from "lucide-react"; // the one glyph on the panel
import { LoginForm } from "@/components/login-form"; // the card

export const metadata: Metadata = { title: "Sign in" }; // "Sign in · Biometric Attendance"

export default function LoginPage() { // two columns on large screens: graphite statement panel + form
  return (
    // full-height split; on phones only the form shows
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* left: the graphite band with one plain statement (no invented numbers) */}
      <section className="hidden flex-col justify-between bg-graphite p-10 text-graphite-ink lg:flex" aria-label="About this dashboard">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-[2px] bg-cobalt-bright" aria-hidden />
          <span className="font-display text-sm font-semibold tracking-tight">Biometric Attendance</span>
        </div>
        <div className="max-w-md space-y-4">
          <Fingerprint className="size-8 text-cobalt-bright" aria-hidden />
          <p className="font-display text-3xl leading-tight font-semibold tracking-tight text-graphite-ink">Open a session. Watch the class list fill in. Export the record.</p>
          <p className="text-sm leading-relaxed text-graphite-muted">Fingerprints stay on the terminal’s sensor. This dashboard only sees who was matched, when, and by which terminal.</p>
        </div>
        <p className="font-mono text-xs tracking-[0.08em] text-graphite-muted uppercase">Lecturer · Administrator</p>
      </section>

      {/* right: the sign-in card, centred in its column */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
