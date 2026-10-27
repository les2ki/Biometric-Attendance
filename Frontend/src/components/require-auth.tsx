"use client"; // reads auth state and redirects in the browser

import { useEffect, type ReactNode } from "react"; // React
import { usePathname, useRouter } from "next/navigation"; // redirect + current path for ?next=
import { toast } from "sonner"; // "no access" message
import { FullScreenLoader } from "@/components/full-screen-loader"; // waiting state
import { homeFor, useAuth } from "@/lib/auth"; // session + role routing
import type { Role } from "@/lib/types"; // role names

interface RequireAuthProps { children: ReactNode; roles?: Role[]; } // optional role restriction

export function RequireAuth({ children, roles }: RequireAuthProps) { // guard: logged in (and right role) or redirect
  const { ready, token, user, expiredOnRestore, loggedOut } = useAuth(); // session state
  const router = useRouter(); // redirect helper
  const pathname = usePathname(); // where the visitor was going
  const wrongRole = !!user && !!roles && !roles.includes(user.role); // logged in but not allowed here

  useEffect(() => { // send logged-out visitors to the login page, remembering where they were going
    if (!ready || token || loggedOut) return; // still loading, logged in, or logout() is already redirecting
    const params = new URLSearchParams(); // query for /login
    if (expiredOnRestore) params.set("expired", "1"); // show the expiry banner
    params.set("next", pathname); // come back here after signing in (validated on the login page)
    router.replace(`/login?${params.toString()}`); // go
  }, [ready, token, expiredOnRestore, loggedOut, pathname, router]); // re-check when the session changes

  useEffect(() => { // wrong role: explain and send them home (admin spec A2)
    if (!wrongRole || !user) return; // nothing to do
    toast.error("You don’t have access to the admin area.", { id: "no-admin-access" }); // fixed id → shown once even if this runs twice
    router.replace(homeFor(user.role)); // lecturers → /lecturer
  }, [wrongRole, user, router]); // when the role check changes

  if (!ready || !token || !user) return <FullScreenLoader label={ready ? "Redirecting to sign in" : "Restoring your session"} />; // avoid flashing the login page on refresh
  if (wrongRole) return null; // render nothing while redirecting
  return <>{children}</>; // allowed
}
