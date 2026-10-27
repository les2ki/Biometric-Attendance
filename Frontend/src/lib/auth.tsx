"use client"; // uses browser storage, timers and React context

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react"; // React building blocks
import { useRouter } from "next/navigation"; // client-side redirects
import { useQueryClient } from "@tanstack/react-query"; // to wipe cached data on logout
import { apiFetch, loginRequest, setUnauthorizedHandler } from "@/lib/api"; // HTTP layer
import type { Role, UserOut } from "@/lib/types"; // account types

const STORAGE_KEY = "ba.auth"; // sessionStorage key (spec U3: sessionStorage, never localStorage/cookies)

interface StoredAuth { token: string; user: UserOut; expiresAt: number; } // what we persist for the tab

// ---- a tiny external store: one source of truth for the session, shared by every component ----

let current: StoredAuth | null | undefined = undefined; // undefined = not read from sessionStorage yet
let expiredOnRestore = false; // true when the saved token had already expired at load (→ show the expiry banner)
let loggedOutOnPurpose = false; // true after logout() — logout() does its own redirect, so guards must not
const listeners = new Set<() => void>(); // components waiting for changes

function readStorage(): StoredAuth | null { // load + validate the saved session
  try { // sessionStorage can throw (privacy mode) and JSON can be corrupt
    const raw = window.sessionStorage.getItem(STORAGE_KEY); // saved JSON
    if (!raw) return null; // nothing saved
    const parsed = JSON.parse(raw) as Partial<StoredAuth>; // untrusted shape
    if (!parsed.token || !parsed.user || typeof parsed.expiresAt !== "number") return null; // incomplete
    if (parsed.expiresAt <= Date.now()) { // token already expired while the tab was closed/asleep
      window.sessionStorage.removeItem(STORAGE_KEY); // clean up
      expiredOnRestore = true; // remember why we're logged out
      return null; // treat as logged out
    }
    return parsed as StoredAuth; // valid session
  } catch { // storage blocked or JSON broken
    return null; // logged out
  }
}

function getSnapshot(): StoredAuth | null { // what the browser currently knows
  if (current === undefined) current = readStorage(); // read once, then cache (must return a stable value)
  return current; // cached session or null
}

function getServerSnapshot(): undefined { // during server render + hydration we don't know yet
  return undefined; // "not ready" — RequireAuth shows a loader instead of flashing the login page
}

function subscribe(listener: () => void): () => void { // React subscribes here
  listeners.add(listener); // start listening
  return () => { listeners.delete(listener); }; // stop listening on unmount
}

function writeSession(next: StoredAuth | null): void { // update memory + sessionStorage, then notify React
  current = next; // in-memory copy
  try { // storage can throw
    if (next) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); // persist for refreshes
    else window.sessionStorage.removeItem(STORAGE_KEY); // clear on logout
  } catch { // privacy mode: keep working in memory only
    /* nothing else to do */
  }
  listeners.forEach((listener) => listener()); // re-render subscribers
}

// ---- React context ----

export type LogoutReason = "expired" | "manual"; // why the user is leaving

interface AuthContextValue { // what useAuth() returns
  token: string | null; // bearer token
  user: UserOut | null; // logged-in account
  expiresAt: number | null; // ms timestamp when the token dies
  ready: boolean; // false until sessionStorage has been read (avoids a login-page flash)
  expiredOnRestore: boolean; // the saved session had expired before this page load
  loggedOut: boolean; // logout() ran and is already navigating to /login
  login: (email: string, password: string) => Promise<UserOut>; // sign in
  logout: (reason?: LogoutReason) => void; // sign out (+ redirect)
  hasRole: (...roles: Role[]) => boolean; // role check helper
  updateUser: (user: UserOut) => void; // refresh the stored profile (e.g. after /auth/me)
}

const AuthContext = createContext<AuthContextValue | null>(null); // filled by AuthProvider

export function AuthProvider({ children }: { children: ReactNode }) { // wraps the whole app (inside QueryClientProvider)
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); // undefined (unknown) | null | session
  const router = useRouter(); // for redirects
  const queryClient = useQueryClient(); // cached API data

  const logout = useCallback((reason: LogoutReason = "manual") => { // clear everything and go to the login page
    loggedOutOnPurpose = true; // tell the guards not to redirect as well
    const next = window.location.pathname; // where the user was
    writeSession(null); // forget the token
    queryClient.clear(); // no student data stays in memory after logout
    router.replace(reason === "expired" ? `/login?expired=1&next=${encodeURIComponent(next)}` : "/login"); // expired → banner + come back here after signing in
  }, [queryClient, router]); // stable between renders

  const login = useCallback(async (email: string, password: string) => { // sign in and remember the session
    const result = await loginRequest(email, password); // POST /auth/login (form encoded)
    const expiresAt = Date.now() + result.expires_in * 1000; // absolute expiry time
    expiredOnRestore = false; // a fresh login clears the old reason
    loggedOutOnPurpose = false; // ditto
    writeSession({ token: result.access_token, user: result.user, expiresAt }); // save to state + sessionStorage
    return result.user; // caller decides where to go
  }, []); // no dependencies

  const updateUser = useCallback((user: UserOut) => { // keep the stored profile fresh
    const now = getSnapshot(); // current session
    if (now) writeSession({ ...now, user }); // replace just the user
  }, []); // no dependencies

  const token = session ? session.token : null; // convenience values
  const expiresAt = session ? session.expiresAt : null; // ms timestamp

  useEffect(() => { // global 401 handler: any request with a dead token logs out
    setUnauthorizedHandler(() => logout("expired")); // register
    return () => setUnauthorizedHandler(null); // unregister on unmount
  }, [logout]); // re-register if logout changes

  useEffect(() => { // expiry timer: log out the moment the token dies
    if (!expiresAt) return; // not logged in
    const timer = window.setTimeout(() => logout("expired"), Math.max(0, expiresAt - Date.now())); // fire at expiry
    return () => window.clearTimeout(timer); // cancel on logout/unmount
  }, [expiresAt, logout]); // reset when the session changes

  useEffect(() => { // background check after a refresh: is the token still accepted?
    if (!token) return; // nothing to check
    const controller = new AbortController(); // cancel if the component unmounts
    apiFetch<UserOut>("/auth/me", { token, signal: controller.signal }) // 401 here triggers the global logout
      .then((user) => updateUser(user)) // pick up name/role changes made by an admin
      .catch(() => { /* network errors are ignored here; 401 already logged out */ }); // swallow
    return () => controller.abort(); // cleanup
  }, [token, updateUser]); // once per token

  const value = useMemo<AuthContextValue>(() => ({ // memoised so consumers only re-render on real changes
    token, // bearer token
    user: session ? session.user : null, // account
    expiresAt, // expiry
    ready: session !== undefined, // sessionStorage has been read
    expiredOnRestore: session === null && expiredOnRestore, // logged out because the old token ran out
    loggedOut: session === null && loggedOutOnPurpose, // logout() is handling the redirect
    login, // sign in
    logout, // sign out
    hasRole: (...roles: Role[]) => !!session && roles.includes(session.user.role), // role check
    updateUser, // profile refresh
  }), [session, token, expiresAt, login, logout, updateUser]); // recompute when any of these change

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>; // share it
}

export function useAuth(): AuthContextValue { // read the auth context
  const ctx = useContext(AuthContext); // nearest provider
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>"); // programming error
  return ctx; // auth state + actions
}

export function useToken(): string | null { // token only (for data hooks)
  return useAuth().token; // bearer token or null
}

export function homeFor(role: Role): string { // where each role lands after login (admin spec A1)
  return role === "admin" ? "/admin" : "/lecturer"; // admins → Administration, lecturers → Sessions
}

export function canAccess(role: Role, path: string): boolean { // route protection rule (admin spec A2)
  if (path === "/admin" || path.startsWith("/admin/")) return role === "admin"; // /admin/** is admins only
  return true; // /lecturer/** and /account are open to both roles
}

export function safeNext(next: string | null, role: Role): string | null { // validate ?next= (no open redirects)
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null; // only same-site absolute paths
  if (next.startsWith("/login")) return null; // never bounce back to the login page
  return canAccess(role, next) ? next : null; // only where this role may go
}
