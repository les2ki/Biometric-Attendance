import { Suspense, type ReactNode } from "react"; // pages below read URL params → need a Suspense boundary (Cache Components)
import { AppShell } from "@/components/app-shell"; // sidebar + top bar
import { FullScreenLoader } from "@/components/full-screen-loader"; // fallback while client code takes over
import { RequireAuth } from "@/components/require-auth"; // login guard

export default function AuthenticatedLayout({ children }: { children: ReactNode }) { // every page in the (app) group
  return (
    // Suspense: lets Next prerender a loader shell; everything inside renders in the browser (spec U2)
    <Suspense fallback={<FullScreenLoader label="Loading" />}>
      {/* guard first, then the chrome */}
      <RequireAuth>
        <AppShell>{children}</AppShell>
      </RequireAuth>
    </Suspense>
  );
}
