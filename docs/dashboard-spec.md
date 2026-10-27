# Milestone B-UI — Next.js Dashboard — Implementation Spec

Project: Biometric Student Attendance and Verification System
Audience: the coding agent implementing this, plus Bubbles reviewing it
Prerequisite: Milestone B backend done (56 tests green). Read `docs/milestone-b-spec.md` for the API.
Goal: a browser dashboard for **lecturers (Phase 1, needed for the mock presentation)** and **admins (Phase 2)**.

---

## 0. Read this first (agent instructions)

### 0.1 Location — mandatory

- **All frontend code lives in `<root>\Frontend\`** (folder already created, currently empty).
  `<root>` = `C:\Users\ACER\OneDrive\Desktop\Biometric attendance\Biometrics Project folder`
- The Next.js app sits **directly in `Frontend\`** (so `Frontend\package.json`, `Frontend\src\...`). No extra nested folder.
- Do **not** touch anything in `Backend\` except where §9 explicitly says so.
- Windows is case-insensitive: `Frontend` and `frontend` are the same folder.

### 0.2 Locked decisions

| # | Decision |
|---|---|
| U1 | **Next.js (App Router) + TypeScript (strict) + Tailwind + shadcn/ui.** Data fetching with **TanStack Query v5**. Forms with **react-hook-form + zod**. Toasts with **sonner**. Icons **lucide-react**. Theme toggle with **next-themes**. |
| U2 | **Client-rendered dashboard.** Every page under the authenticated area is a client component (`"use client"`). No Next.js API routes, no server actions, no middleware auth. The browser calls FastAPI directly at `NEXT_PUBLIC_API_URL`. |
| U3 | **Auth = bearer JWT from `POST /auth/login`**, kept in React state and mirrored to **`sessionStorage`** (survives refresh, cleared when the tab closes). Never `localStorage`, never cookies. |
| U4 | **Phase 1 = lecturer flow only** (login → open session → live roster → manual mark / revoke → export CSV → close). Admins can log in and use the lecturer pages (the backend lets admins see every course). The admin pages are Phase 2 (§8). |
| U5 | **Neutral, clean theme** with light/dark mode. **No TUT logo, name or colours.** The product name shown is **"Biometric Attendance"**. |
| U6 | **Live updates by polling** (`refetchInterval` 3 s on the open-session roster). No websockets. |
| U7 | Students never log in (backend decision D1). No student pages. |

### 0.3 Coding conventions (owner's standing rules)

1. **Comment the code so the owner can learn from it.** Every line of logic (TS statements, hooks, handlers, fetch code, types) gets a short end-of-line `//` comment. In JSX, put a `{/* ... */}` comment above each meaningful element or block (a card, a table, a dialog, a button group); you don't need to comment every attribute line.
2. Once a file exists, later edits must not restyle or reword existing code or comments. Only add or change what the feature needs.
3. TypeScript `strict: true`. No `any`. API types come from `src/lib/types.ts` (§4.4). Never invent fields the backend doesn't return.
4. All API calls go through `src/lib/api.ts`. No raw `fetch` in components.
5. Every API error the user can trigger is shown as a friendly toast, using the error-code map in §4.5.
6. Show every date and time in **Africa/Johannesburg** using `Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", ... })` (§4.6).
7. Before calling a work package done: `npm run lint` and `npm run build` both pass with zero errors.

### 0.4 Priority / scope cut line

- **P1 (for the mock):** WP1–WP6 (setup, API layer, auth, shell, lecturer overview, live session page).
- **P1.5:** WP7 (courses list + attendance report, account/change-password).
- **P2 (after the mock):** WP8 admin pages, WP9 PWA manifest, WP10 Playwright smoke test.

---

## 1. Work packages

| WP | Content | Checkpoint |
|---|---|---|
| WP1 | Scaffold Next.js + Tailwind + shadcn + libraries, env files | `npm run dev` shows the placeholder page at http://localhost:3000 |
| WP2 | `lib/` layer: api client, types, errors, format, query client, providers | `npm run build` passes |
| WP3 | Auth: AuthProvider, login page, route guard, expiry handling | Can log in as the seeded lecturer; refresh keeps you logged in; logout works |
| WP4 | App shell: sidebar, top bar, theme toggle, responsive menu | Navigation works on desktop and at phone width |
| WP5 | Lecturer overview: open sessions, recent sessions, "Open session" dialog | Opening a session works; the terminal (`fake_terminal session`) sees it |
| WP6 | Live session page: stats, roster table, manual mark, revoke, export, close | Full demo script §10 works |
| WP7 | Courses + report page, account page | Report shows percentages |
| WP8 | Admin pages (Phase 2) | §8 checklist |
| WP9 | PWA manifest + icons (optional) | "Install app" available in Chrome |
| WP10 | Playwright smoke test (optional) | `npx playwright test` green |

---

## 2. WP1 — Scaffold

Run from `<root>` (the parent of `Frontend`), **not** from inside `Frontend`. `create-next-app` uses the folder name as the npm package name, and npm names can't contain capital letters. Passing lowercase `frontend` passes that check, and on Windows it resolves to the existing empty `Frontend` folder.

```powershell
cd "C:\Users\ACER\OneDrive\Desktop\Biometric attendance\Biometrics Project folder"
node -v   # must be v20 or newer; install Node LTS from nodejs.org if missing
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
cd Frontend
npx shadcn@latest init        # style: default/new-york, base color: neutral, CSS variables: yes
npx shadcn@latest add button input label textarea card table badge dialog alert-dialog select tabs dropdown-menu sheet skeleton sonner separator tooltip avatar
npm install @tanstack/react-query react-hook-form zod @hookform/resolvers next-themes lucide-react
npm install -D @tanstack/react-query-devtools
```

If `create-next-app` refuses because the folder isn't empty, check that `Frontend` really is empty (hidden files included), then retry. Accept whatever current Next.js version `@latest` installs. If it is Next 15+, dynamic route `params` are async in server components. We avoid that by using `useParams()` in client components (§6).

### 2.1 Env files (inside `Frontend`)

`Frontend\.env.local` (git-ignored by the generated `.gitignore`):
```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_APP_NAME=Biometric Attendance
NEXT_PUBLIC_TIMEZONE=Africa/Johannesburg
```
Create `Frontend\.env.example` with the same keys. Make sure `.env.example` is **not** ignored: if the generated `.gitignore` has `.env*`, add the line `!.env.example`.

The backend's `.env` already allows `http://localhost:3000` and `http://127.0.0.1:3000` in `cors_origins`. Open the dashboard at **http://localhost:3000**.

### 2.2 Clean-up

Replace the generated `src/app/page.tsx` content with a redirect (§5.1). Remove the demo images from `public/`. Set `<title>` to the app name in `layout.tsx` metadata.

---

## 3. Folder structure (target)

```
Frontend/
  .env.local                  (ignored)
  .env.example
  components.json             (shadcn)
  src/
    app/
      layout.tsx              root: <html>, fonts, <Providers>, <Toaster/>
      page.tsx                redirect → /login or /lecturer
      login/page.tsx          login form
      (app)/                  route group = authenticated area
        layout.tsx            <RequireAuth> + <AppShell>
        lecturer/page.tsx                 overview (WP5)
        lecturer/sessions/[id]/page.tsx   live session (WP6)
        lecturer/courses/page.tsx         courses (WP7)
        lecturer/courses/[id]/page.tsx    report (WP7)
        account/page.tsx                  change password (WP7)
        admin/...                         Phase 2 (WP8)
      not-found.tsx
    components/
      ui/                     shadcn generated (don't hand-edit except via shadcn)
      providers.tsx           QueryClientProvider + ThemeProvider + AuthProvider
      require-auth.tsx        guard
      app-shell.tsx           sidebar + top bar + content
      nav-links.tsx           role-based nav items
      theme-toggle.tsx
      user-menu.tsx
      stat-card.tsx
      status-badge.tsx        present / absent / revoked
      method-badge.tsx        fingerprint / face / manual
      device-badge.tsx        online / offline / busy
      empty-state.tsx
      lecturer/
        open-session-dialog.tsx
        session-card.tsx
        sessions-table.tsx
        roster-table.tsx
        manual-mark-dialog.tsx
        revoke-dialog.tsx
        close-session-dialog.tsx
        export-button.tsx
    lib/
      api.ts                  apiFetch, ApiError, login, downloadFile
      auth.tsx                AuthProvider, useAuth
      errors.ts               error code → friendly message
      types.ts                TS mirrors of backend schemas
      format.ts               date/time helpers (Africa/Johannesburg)
      query-client.ts         QueryClient factory + defaults
      query-keys.ts           all query keys in one place
    hooks/
      use-lecturer.ts         query + mutation hooks for /lecturer/*
```

---

## 4. WP2 — The `lib/` layer

### 4.1 `lib/api.ts`

- `export const API_URL = process.env.NEXT_PUBLIC_API_URL!` (throw a clear error at import if missing).
- `export class ApiError extends Error { status: number; code: string; fieldErrors?: Record<string,string> }`
  - FastAPI errors look like `{"detail": "device_busy"}` → `code = "device_busy"`.
  - Validation errors (422) look like `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}` → `code = "validation_error"`, with `fieldErrors` keyed by the last `loc` element.
  - Network failure (backend not running) → `status = 0`, `code = "network_error"`.
- `export async function apiFetch<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {}): Promise<T>`
  - Sends JSON (`Content-Type: application/json`) when `body` is given, plus `Authorization: Bearer <token>` when `token` is given.
  - `204` → returns `undefined as T`.
  - Non-2xx → throws `ApiError`.
  - On **401**, calls a registered `onUnauthorized` callback (set by the AuthProvider) **before** throwing, so the app logs out globally.
- `export async function loginRequest(email: string, password: string): Promise<TokenOut>` — POST `/auth/login` with `application/x-www-form-urlencoded` (`URLSearchParams({ username: email, password })`). **Not JSON**, because the backend uses `OAuth2PasswordRequestForm`.
- `export async function downloadFile(path: string, token: string): Promise<void>` — fetch with the auth header, read the `Content-Disposition` filename (the backend exposes this header via CORS; fall back to `attendance.csv`), make an object URL from the blob, click a temporary `<a download>`, then revoke the URL.

### 4.2 `lib/query-client.ts`

QueryClient defaults:
- `staleTime: 10_000`, `refetchOnWindowFocus: true`
- `retry`: no retry when the error is an `ApiError` with status 4xx; up to 2 retries otherwise.
- Mutations: `retry: false`.

### 4.3 `lib/query-keys.ts`

```ts
export const qk = {                                         // every query key in one place
  me: ["auth", "me"] as const,                              // current user
  lecturerCourses: ["lecturer", "courses"] as const,        // courses I teach
  lecturerDevices: ["lecturer", "devices"] as const,        // terminals for the picker
  sessions: (f: { courseId?: number; openOnly?: boolean; offset?: number }) => ["lecturer", "sessions", f] as const, // session lists
  session: (id: number) => ["lecturer", "session", id] as const,        // one session header
  attendance: (id: number) => ["lecturer", "attendance", id] as const,  // live roster
  report: (courseId: number) => ["lecturer", "report", courseId] as const, // course report
};
```

### 4.4 `lib/types.ts` — mirror the backend exactly

These were copied from `Backend/app/schemas/*`. Datetimes arrive as ISO strings.

```ts
export type Role = "admin" | "lecturer";                        // dashboard roles
export type Method = "fingerprint" | "face" | "manual";        // how attendance was recorded
export type RosterStatus = "present" | "absent" | "revoked";   // roster line state

export interface UserOut { id: number; email: string; full_name: string; role: Role; is_active: boolean; created_at: string; } // account
export interface TokenOut { access_token: string; token_type: "bearer"; expires_in: number; user: UserOut; }                  // login response
export interface Page<T> { items: T[]; total: number; }                                                                      // paginated list

export interface CourseOut { id: number; code: string; name: string; is_active: boolean; lecturer_count: number; student_count: number; } // course
export interface DeviceSummary { id: number; name: string; online: boolean; busy: boolean; }                                            // terminal picker row

export interface SessionCreate { course_id: number; device_id: number; venue: string; }        // open-session body
export interface SessionCounts { roster: number; present: number; absent: number; }           // headline numbers
export interface SessionOut {                                                                  // session header
  id: number; course_id: number; course_code: string; course_name: string; venue: string;
  device_id: number; device_name: string; lecturer_id: number; lecturer_name: string;
  opened_at: string; closed_at: string | null; is_open: boolean; counts: SessionCounts;
}
export interface RosterEntry {                                                                 // one student in one session
  student_id: number; student_number: string; full_name: string; status: RosterStatus;
  attendance_id: number | null; method: Method | null; recorded_at: string | null; device_time: string | null;
  fp_confidence: number | null; note: string | null; revoked_at: string | null; revoke_reason: string | null;
  recorded_by_name: string | null;
}
export interface RosterView { session: SessionOut; entries: RosterEntry[]; }                   // live roster response
export interface ManualMark { student_number: string; reason: string; }                         // manual mark body (reason 3–255)
export interface RevokeIn { reason: string; }                                                    // revoke body (reason 3–255)
export interface ReportRow { student_id: number; student_number: string; full_name: string; attended: number; percentage: number; } // report line
export interface CourseReport { course: CourseOut; closed_sessions: number; students: ReportRow[]; }                                 // report
export interface ChangePasswordIn { current_password: string; new_password: string; }           // new password ≥ 8
```

If anything here disagrees with `http://127.0.0.1:8000/openapi.json`, **the backend wins**. Update this file and tell the owner.

### 4.5 `lib/errors.ts` — friendly messages

`export function errorMessage(err: unknown): string` returns a human sentence for an `ApiError` code, or a generic fallback.

| code | Message |
|---|---|
| `network_error` | Can't reach the server. Is the backend running on port 8000? |
| `invalid_credentials` | Email or password is incorrect. |
| `token_expired` / `invalid_token` / `inactive_user` | Your session has ended. Please log in again. |
| `forbidden` | You don't have permission to do that. |
| `course_not_found` | Course not found, or you're not assigned to it. |
| `course_inactive` | This course is archived. |
| `device_not_found` | Terminal not found. |
| `device_inactive` | This terminal is disabled. |
| `device_busy` | That terminal already has an open session. Close it first or pick another terminal. |
| `session_not_found` | Session not found. |
| `session_already_closed` | This session is already closed. |
| `unknown_student` | No student with that number. |
| `not_in_course` | That student isn't on this course's class list. |
| `student_inactive` | That student is deactivated. |
| `already_present` | That student is already marked present. |
| `attendance_not_found` | Attendance record not found. |
| `already_revoked` | That record was already revoked. |
| `wrong_current_password` | Your current password is incorrect. |
| `validation_error` | Please check the highlighted fields. |
| (anything else) | Something went wrong (`<code>`). |

### 4.6 `lib/format.ts`

- `fmtDateTime(iso)` → `"20 Oct 2026, 09:05"`
- `fmtTime(iso)` → `"09:05:12"`
- `fmtDate(iso)` → `"Mon 20 Oct 2026"`
- `fmtRelative(iso)` → `"just now" | "2 min ago" | "1 h ago"`. Recompute every 30 s where shown.
- `fmtDuration(fromIso, toIso | null)` → `"1 h 12 min"` (uses now when `to` is null).
- All use `process.env.NEXT_PUBLIC_TIMEZONE`, default `Africa/Johannesburg`, locale `en-ZA`.

### 4.7 `components/providers.tsx`

Wrap the app in `ThemeProvider` (attribute `class`, defaultTheme `system`), then `QueryClientProvider` (one client per browser via `useState`), then `AuthProvider`. Mount `ReactQueryDevtools` in development only. `<Toaster richColors position="top-right" />` goes in the root layout.

---

## 5. WP3 — Auth

### 5.1 `lib/auth.tsx` — `AuthProvider` / `useAuth()`

State: `{ token: string | null; user: UserOut | null; expiresAt: number | null; ready: boolean }`.

- **On mount:** read `sessionStorage["ba.auth"]` (JSON `{token, user, expiresAt}`). If it exists and `expiresAt > Date.now()`, restore it, then set `ready = true`. Optionally confirm with `GET /auth/me` in the background and log out if that returns 401.
- **`login(email, password)`:**
  1. Call `loginRequest`.
  2. Compute `expiresAt = Date.now() + expires_in * 1000`.
  3. Save to state and sessionStorage.
  4. Return the user.
- **`logout(reason?: "expired" | "manual")`:**
  1. Clear state and sessionStorage.
  2. Run `queryClient.clear()` so no data stays in memory after logout.
  3. Redirect with `router.replace("/login" + (reason === "expired" ? "?expired=1" : ""))`.
- **Expiry timer:** while logged in, set a `setTimeout` for `expiresAt - Date.now()` that calls `logout("expired")`. Clear it on logout or unmount.
- **Global 401:** register `onUnauthorized = () => logout("expired")` with `api.ts`.
- **Helpers:** `useToken()` returns the token for hooks; `hasRole(...roles)`.

### 5.2 `app/login/page.tsx`

- Centred card titled "Biometric Attendance" with the subtitle "Staff sign in".
- Fields: email (type email, autocomplete `username`) and password (autocomplete `current-password`, show/hide toggle). Validate with zod (email format; password required).
- Submit button with a spinner while pending. On error, show `errorMessage(err)` inline above the button (not only a toast).
- `?expired=1` shows a muted banner: "Your session expired. Please sign in again."
- **There is one login page for admins and lecturers, with no role picker.** After success, redirect by the role in the response: lecturer → `/lecturer`, admin → `/admin` once the admin pages exist (`/lecturer` until then). Use the `homeFor(role)` helper described in `docs/admin-dashboard-spec.md` §2.
- Already logged in → redirect straight to `homeFor(user.role)`.
- Small footer text: "Students don't need an account. Attendance is captured at the terminal."

### 5.3 `components/require-auth.tsx` and `app/(app)/layout.tsx`

- Until `ready`, show a full-screen skeleton or spinner. Without this, a refresh flashes the login page.
- Not logged in → `router.replace("/login")`.
- Optional prop `roles?: Role[]`. A wrong role shows a "You don't have access to this page" empty state with a link home.
- `(app)/layout.tsx` = `<RequireAuth><AppShell>{children}</AppShell></RequireAuth>`.

### 5.4 `app/page.tsx`

Client redirect: logged in → `/lecturer`, else `/login`.

---

## 6. WP4–WP6 — Lecturer UI (Phase 1)

### 6.1 WP4 — App shell (`components/app-shell.tsx`)

- **Desktop (≥ md):** fixed left sidebar (w-60) with the app name at the top, nav links in the middle, and the user card at the bottom.
- **Mobile:** a top bar with a hamburger that opens the same nav in a shadcn `Sheet`.
- **Top bar (right side):** live clock (Africa/Johannesburg, HH:mm), `ThemeToggle`, and `UserMenu` (avatar initials, name, role badge; items "Account" and "Log out").
- **Nav for lecturers:** Sessions (`/lecturer`, icon `CalendarCheck`), Courses (`/lecturer/courses`, icon `BookOpen`), Account (`/account`).
- **Admins (Phase 2)** additionally get an "Administration" section: Students, Courses, Devices, Users, Audit log.
- Highlight the active link with `usePathname()`. Content area: `max-w-7xl mx-auto p-4 md:p-6`.

### 6.2 `hooks/use-lecturer.ts` — data hooks

| Hook | Call | Notes |
|---|---|---|
| `useLecturerCourses()` | GET `/lecturer/courses` | `CourseOut[]` |
| `useLecturerDevices(enabled)` | GET `/lecturer/devices` | `DeviceSummary[]`, `refetchInterval: 10_000` while the dialog is open |
| `useSessions({courseId, openOnly, offset, limit=20})` | GET `/lecturer/sessions?limit&offset&course_id&open_only` | `Page<SessionOut>`, `placeholderData: keepPreviousData` |
| `useOpenSessions()` | same with `open_only=true&limit=50` | `refetchInterval: 15_000` |
| `useSession(id)` | GET `/lecturer/sessions/{id}` | |
| `useRoster(id, isOpen)` | GET `/lecturer/sessions/{id}/attendance` | `refetchInterval: isOpen ? 3000 : false`. Polling stops automatically while the tab is hidden (TanStack default). |
| `useOpenSession()` | POST `/lecturer/sessions` | on success: invalidate `["lecturer","sessions"]` and `lecturerDevices`, then `router.push('/lecturer/sessions/'+id)` |
| `useCloseSession(id)` | POST `/lecturer/sessions/{id}/close` | on success: invalidate session, attendance and sessions |
| `useManualMark(sessionId)` | POST `/lecturer/sessions/{id}/manual` | on success: invalidate attendance and session; toast "<name> marked present" |
| `useRevoke(sessionId)` | POST `/lecturer/attendance/{attendanceId}/revoke` | on success: invalidate attendance and session; toast "Record revoked" |
| `useCourseReport(courseId)` | GET `/lecturer/courses/{id}/report` | WP7 |
| `useChangePassword()` | POST `/auth/change-password` | WP7 |

Every mutation's `onError` calls `toast.error(errorMessage(err))`. For `validation_error`, also map `fieldErrors` onto the form with `setError`.

### 6.3 WP5 — Overview page `/lecturer`

**Header:** title "Sessions", subtitle "Good morning, <first name>" (morning/afternoon/evening by Johannesburg time), and a primary **"Open session"** button on the right.

**Section A — "Running now"** (from `useOpenSessions`):
- A grid of `SessionCard`s, one per open session. Each card shows:
  - course code (bold) and course name;
  - venue and terminal name;
  - "Opened 09:05 · 1 h 12 min";
  - a progress bar for present/roster with the text "23 / 60 present";
  - a **Live** badge with a pulsing dot.
- Clicking a card goes to `/lecturer/sessions/[id]`.
- Empty state: "No session running", with an "Open session" button.

**Section B — "Recent sessions"** (`useSessions`, 20 per page):
- Course filter: a `Select` filled from `useLecturerCourses`, with "All courses" as the default.
- Columns: Date, Course, Venue, Terminal, Present (x / y and %), Status (Open / Closed badge), and a chevron. Clicking a row opens the session.
- Pagination: Previous / Next buttons and the text "Showing 1–20 of 57".
- Loading uses skeleton rows; when there are no sessions, show an empty state.

**`OpenSessionDialog`** (react-hook-form + zod):
- **Course:** a `Select` of active courses, showing "PD2316D — Project Design III (60 students)". If there's only one course, preselect it. If there are none: "You're not assigned to any course yet. Ask an administrator." (disable submit).
- **Terminal:** a `Select` from `useLecturerDevices`. Each option shows the name plus a `DeviceBadge`: Online (green dot), Offline (grey), or Busy (amber, disabled option, "in use").
  - An offline terminal can still be chosen, with a warning under the field: "This terminal hasn't checked in recently. Make sure it's switched on and connected to Wi-Fi."
- **Venue:** text, 1–50 chars, placeholder "e.g. Building 10, Room 112". Remember the last venue in sessionStorage as a convenience.
- Submit: "Start session". A spinner shows while pending. On success, close the dialog and navigate to the live page.
- Error `device_busy` → toast plus a refetch of devices.

### 6.4 WP6 — Live session page `/lecturer/sessions/[id]`

Read the id with `const { id } = useParams<{ id: string }>()`, then `Number(id)`. A non-numeric id renders not-found.

Data:
- `useSession(id)` for the header.
- `useRoster(id, session?.is_open)` for the table. `RosterView.session` also carries fresh counts, so prefer the roster's `session` for header numbers once it has loaded.

**Header block:**
- Breadcrumb: Sessions › PD2316D.
- Title "PD2316D — Project Design III". Meta line: venue, terminal, "Opened 20 Oct 2026, 09:05", lecturer name.
- Status: if open, a green **Live** badge with a pulsing dot plus "Updated 2 s ago" (from the query's `dataUpdatedAt`, ticking every second). If closed, a grey "Closed at 10:30" badge plus the duration.
- Actions, right-aligned and wrapping on mobile:
  - **Mark present** (opens `ManualMarkDialog` empty, for walk-ins and students without biometrics);
  - **Export CSV** (`ExportButton`);
  - **Close session** (destructive outline, open sessions only, opens `CloseSessionDialog`).

**Stat cards** (4 in a row; 2×2 on mobile):
- Present (count, with "of 60");
- Absent;
- Attendance % (present / roster, 1 decimal);
- By method ("18 fingerprint · 2 manual", computed from the entries).

**Roster table** (`RosterTable`):
- **Tabs above the table:** All (60), Present (20), Absent (39), Revoked (1). Counts are computed client-side.
- **Search box:** filters by student number or name, case-insensitive. The search state stays in the URL query (`?q=` and `?tab=`) so a refresh keeps it.
- **Columns:**

| Column | Content |
|---|---|
| Student number | monospace |
| Full name | |
| Status | `StatusBadge`: Present (green), Absent (muted outline), Revoked (amber, with the revoke reason in a tooltip) |
| Method | `MethodBadge` with icon: Fingerprint (`Fingerprint`), Manual (`UserCheck`), Face (`ScanFace`). Empty if absent |
| Time | `fmtTime(recorded_at)`; tooltip shows the full date-time and the device time if present |
| Details | Manual: "by <recorded_by_name>: <note>" (truncated, full text in tooltip). Fingerprint: "score <fp_confidence>" in small muted text |
| Actions | Absent → "Mark present". Present → "Revoke" (ghost destructive). Revoked → "Reinstate", which opens ManualMarkDialog because the backend reinstates via manual mark |

- **Sort:** by name, which is the backend order. Optional: clicking the "Time" header sorts by recorded_at, newest first.
- **New-arrival highlight:** keep a `useRef<Set<number>>` of student IDs present in the previous poll. Rows that just became present get a 3-second green background fade (Tailwind transition). Don't highlight on the first load.
- **Empty roster:** "No students on this course's class list. Ask an administrator to add them."
- **Loading:** 8 skeleton rows. **Error:** an inline error card with a "Retry" button.

**`ManualMarkDialog`:**
- Props: `sessionId`, optional `student` (prefill). Title "Mark present".
- Fields:
  - Student number, read-only when prefilled; otherwise free text, 6–12 digits.
  - When prefilled, show the student's name.
  - Reason: textarea, 3–255 chars. Quick-pick chips fill it: "No biometric consent, ID verified", "Fingerprint not recognised, ID verified", "Arrived after terminal issue", "Correction".
- Helper text: "This is recorded with your name and the reason in the audit log."
- Submit calls `useManualMark`. Errors `not_in_course`, `unknown_student` and `already_present` show inline under the field, not just as a toast.
- This works on **closed** sessions too (late corrections). Show the info line "This session is closed. This will be recorded as a correction."

**`RevokeDialog`:**
- An AlertDialog: "Revoke attendance for <name>?"
- Body: "The record is kept but no longer counts as present. You can reinstate it later."
- Reason textarea (3–255), required. Confirm button is destructive "Revoke".

**`CloseSessionDialog`:**
- An AlertDialog: "Close this session?"
- Body: "The terminal will stop accepting fingerprints for this session. Present: 20 of 60. You can still make corrections afterwards."
- Confirm "Close session". On success, the page switches to the closed state, polling stops, and a toast says "Session closed".

**`ExportButton`:**
- Calls `downloadFile('/lecturer/sessions/{id}/export.csv', token)`.
- Shows a spinner while working; on success, toast "Exported attendance_PD2316D_….csv".
- Note: each export writes an `attendance.exported` audit row on the backend (that's intended).

### 6.5 Visual design

- shadcn neutral base colour, `rounded-xl` cards, subtle borders, `text-sm` tables.
- Font: Geist (the create-next-app default) or Inter.
- Status colours must work in light and dark mode:
  - present = emerald;
  - absent = muted/slate;
  - revoked = amber;
  - live dot = emerald with `animate-ping`.
- Never rely on colour alone. Every badge has a text label (and an icon where listed).
- Accessibility:
  - All inputs have `<Label>`s.
  - Dialogs trap focus (shadcn default).
  - Buttons have visible focus rings.
  - Icon-only buttons have an `aria-label`.
  - The table has a `<caption className="sr-only">`.
- Responsive check at 375 px width: the stat cards wrap, and the table scrolls horizontally inside its card (`overflow-x-auto`). The page itself must not scroll sideways.

---

## 7. WP7 — Courses, report, account (P1.5)

- **`/lecturer/courses`:** cards or a table of `CourseOut` (code, name, students, lecturers). Each has two actions:
  - "View sessions" → `/lecturer?course=<id>` (the overview reads the `course` query param into its filter).
  - "Attendance report" → `/lecturer/courses/[id]`.
- **`/lecturer/courses/[id]` (report):**
  - Header with the course and "Based on N closed sessions".
  - Table: student number, name, attended (x / N), and percentage as a bar plus a number.
  - Rows below **75 %** get an amber "At risk" badge. Put the threshold in a constant in `lib/format.ts` or a config file.
  - Sortable by percentage.
  - "Download CSV" builds a CSV client-side from the report data (no backend endpoint needed).
  - If N = 0: "No closed sessions yet."
- **`/account`:** profile (name, email, role, read-only) and a "Change password" form (current password; new password ≥ 8; confirm must match) → `POST /auth/change-password`. A 204 response triggers the toast "Password changed". The error `wrong_current_password` shows inline.

---

## 8. WP8 — Admin pages (Phase 2, after the mock)

> **Superseded by `docs/admin-dashboard-spec.md`.** That spec is the authoritative, detailed version of this section, including the single-login role routing. The table below is kept only as a summary.

Route prefix `(app)/admin/...`, guarded with `<RequireAuth roles={["admin"]}>`. Backend endpoints are listed in `docs/milestone-b-spec.md` §7. Add the matching types to `lib/types.ts` (copy them from `Backend/app/schemas/admin.py`) and the hooks to `hooks/use-admin.ts`.

| Page | Content |
|---|---|
| `/admin` | Overview tiles: students (with and without consent), courses, devices online/offline, pending terminal commands, recent audit entries (last 10). |
| `/admin/students` | Search plus course filter plus active filter, paginated table: number, name, consent badge, "Enrolled on" device chips, active. Button "Add student" (dialog). Row → detail. |
| `/admin/students/[id]` | Profile; **consent card** with a switch. Withdrawing consent shows a confirm dialog warning that fingerprints will be deleted from all terminals. Courses list. **Fingerprints card**: slots per device, "Enrol on terminal…" (pick a device, then `POST /admin/students/{id}/enrol`), and "Delete fingerprints" (confirm). **Open commands** list with live status, polling every 3 s while any is pending or in progress (Pending → In progress → Done/Failed/Expired). Show the instruction: "Ask the student to go to <terminal>. It will show their name and ask for their finger." |
| `/admin/courses` | Table plus "New course" dialog (code is upper-cased automatically). |
| `/admin/courses/[id]` | Edit name/active. **Lecturers** multi-select (active lecturers only) → `PUT …/lecturers`. **Roster**: table with remove buttons; "Add students" textarea (one number per line or comma-separated) → shows the added / already present / unknown result; "Import CSV" upload (`student_number,full_name` header) → shows the result, including row errors. |
| `/admin/devices` | Table: name, online dot, last seen (relative), open session, enrolled count, pending commands, active switch. "Add terminal" → result dialog showing **`DEVICE_ID` and `HMAC secret` once**, with copy buttons and the warning "Copy this into the terminal firmware now. It won't be shown again." Row action "Rotate secret" shows the same one-time dialog. Device detail drawer: command history (`GET /admin/devices/{id}/commands`), cancel button for pending enrol commands. |
| `/admin/users` | Table of admins and lecturers; "Add user" (email, name, role, temporary password); row actions: change role, activate/deactivate, reset password. Show the backend guards `cannot_modify_self` and `last_admin` as friendly errors. |
| `/admin/audit` | Filters: action prefix select (attendance., fingerprint., consent., session., course., device., user.), date range, actor. Table: time, actor, action, entity#id, and an expandable JSON details viewer. Read-only, with no edit or delete buttons anywhere. |

Add the admin error codes to `lib/errors.ts`:
`email_taken, user_not_found, cannot_modify_self, last_admin, student_number_taken, student_not_found, no_consent, already_enrolled, enrolment_pending, sensor_full, course_code_taken, not_a_lecturer, not_on_roster, bad_csv, device_name_taken, unknown_command, command_not_active, wipe_cannot_be_cancelled`.

---

## 9. Backend touchpoints

No backend code changes are expected. Only if something below doesn't hold, raise it with the owner before changing anything in `Backend\`:

- CORS must allow `http://localhost:3000` and expose `Content-Disposition` (already in `app/main.py`).
- `/lecturer/sessions` must accept `limit`, `offset`, `course_id` and `open_only` (it does).
- Run the backend with `fastapi dev app/main.py` from `Backend` (port 8000). Use `--host 0.0.0.0` when the ESP32 also needs to reach it.

---

## 10. Demo script (acceptance for Phase 1 = mock presentation)

Preparation:
1. `cd Backend`, then `python -m alembic upgrade head` and `python -m scripts.seed`.
2. In Swagger (or the admin pages in Phase 2), enrol `220000001` so a fingerprint slot exists: `POST /admin/students/{id}/enrol`, then `fake_terminal next` and `fake_terminal result <id> ok`.
3. Close the seed session if one is open (or use it).

Demo:
1. Start the backend on 8000 and the frontend with `npm run dev` on 3000. Open http://localhost:3000.
2. Log in as `lecturer@tut.ac.za` / `ChangeMe123`. You land on Sessions.
3. **Open session:** PD2316D, terminal-01, "Building 10, Room 112". The live page opens: 0 / 3 present.
4. In a terminal window, run `python -m scripts.fake_terminal session` (shows the new session), then `python -m scripts.fake_terminal mark <session_id> 1 120`. **Within about 3 seconds** Test Student One turns present on the dashboard, with a green highlight and the Fingerprint badge.
5. Run `fake_terminal mark <session_id> 1 120` again. The terminal gets `duplicate` and the dashboard doesn't change.
6. Click **Mark present** for `220000003` (no consent) with the reason "No biometric consent, ID verified". It shows as present with the Manual badge.
7. **Revoke** one record with a reason. It shows as Revoked with the reason in a tooltip. Then **Reinstate** it.
8. **Export CSV** and open it in Excel. Times are in SAST and the columns are correct.
9. **Close session.** The Live badge disappears and polling stops. A terminal scan now returns `session_closed`.
10. Back on Sessions, the session is listed as Closed with 2 / 3 present.

---

## 11. Definition of done (Phase 1)

- [ ] All code is in `Frontend\`; `npm run lint` and `npm run build` pass with zero errors.
- [ ] The §10 demo works end to end.
- [ ] A refresh keeps the user logged in; closing the tab logs out; an expired token sends the user to login with the expiry banner.
- [ ] Every user-triggerable API error shows a friendly message (§4.5).
- [ ] Usable at 375 px width; light and dark mode both look right.
- [ ] No `any`; every logic line is commented; JSX blocks are commented.
- [ ] `.env.example` is committed; `.env.local` and `node_modules` are git-ignored.
- [ ] A short `Frontend\README.md`: prerequisites, `npm install`, env vars, `npm run dev`, and how to log in with the seed accounts.

## 12. Phase 2 extras (optional)

- **WP9 PWA:** `src/app/manifest.ts` (name, short_name "Attendance", theme colour, 192/512 icons generated from a simple fingerprint glyph made by us, not a brand logo). Add an install prompt only if time allows. No offline caching of API data (the dashboard needs the server anyway).
- **WP10 Playwright:** one smoke test that logs in, opens a session, calls the device API through a small Node helper that signs requests like `fake_terminal.py`, and waits for the row to turn present.
