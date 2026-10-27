# Milestone B-UI Phase 2 — Admin Dashboard — Implementation Spec

Project: Biometric Student Attendance and Verification System
Audience: the coding agent implementing this, plus Bubbles reviewing it
Prerequisites:
- `docs/dashboard-spec.md` Phase 1 (lecturer side) is built or in progress in `Frontend\`. This spec **extends** it: same stack, same `lib/` layer, same conventions (§0.3 of that spec).
- Backend Milestone B is done. Admin endpoints and schemas are in `Backend/app/routers/admin_*.py` and `Backend/app/schemas/admin.py`. They are reproduced exactly in §4 below.

Goal: everything an administrator needs, behind the **same single login page** as lecturers:
- manage students and consent (POPIA);
- enrol and delete fingerprints through the terminal command queue;
- manage courses and class lists, terminals, and staff accounts;
- read the audit trail.

---

## 0. Read this first

### 0.1 Location

All code goes in `<root>\Frontend\` (`<root>` = `C:\Users\ACER\OneDrive\Desktop\Biometric attendance\Biometrics Project folder`). Admin pages live under `src/app/(app)/admin/`. No backend changes. If an endpoint doesn't behave as described in §4, stop and tell the owner.

### 0.2 Locked decisions (in addition to dashboard-spec §0.2)

| # | Decision |
|---|---|
| A1 | **One login page for everyone** (`/login`). The role in the login response decides where the user goes: **admin → `/admin`**, **lecturer → `/lecturer`**. There is no role picker on the login form; the account's role is the source of truth. |
| A2 | **Route protection by role.** `/admin/**` is admins only. `/lecturer/**` is lecturers **and** admins (the backend lets admins see every course). `/account` is everyone. A lecturer who opens an `/admin` URL is redirected to `/lecturer` with a toast "You don't have access to the admin area." |
| A3 | **One app shell, role-based navigation.** Admins see an "Administration" section plus a "Teaching" section (the lecturer pages across all courses). Lecturers only see their own section. |
| A4 | **Enrolment is a guided, live flow.** The admin queues it, the page shows the terminal's progress live (polling), and the result is shown inline (done / failed / expired / cancelled). |
| A5 | **Destructive or privacy-sensitive actions always confirm.** That means: withdrawing consent, deleting fingerprints, deactivating a student/user/terminal, rotating a secret, removing from a roster, cancelling a command. Each confirmation says exactly what will happen. |
| A6 | **The device secret is shown once.** Show it after create or rotate in a modal with copy buttons. Never store it in state beyond that modal, never log it, never put it in a URL. |
| A7 | **The audit log is read-only in the UI.** No edit or delete affordance anywhere. |

### 0.3 Priority

- **A-P1 (core admin story):** WP-A1 to WP-A6 (login/guards/nav changes, overview, students and consent, enrolment flow, courses and rosters, terminals).
- **A-P2:** WP-A7 (users), WP-A8 (audit log), WP-A9 (CSV roster import, rotate secret, command cancel, student/user edit, deactivate).
- Each WP must leave `npm run lint` and `npm run build` green.

---

## 1. Work packages

| WP | Content | Checkpoint |
|---|---|---|
| WP-A1 | Single login + role redirect + role guards + admin navigation (changes to existing files) | Admin lands on `/admin`, lecturer on `/lecturer`; a lecturer typing `/admin` gets redirected with a toast |
| WP-A2 | Shared admin components + `lib/types.ts` additions + `hooks/use-admin.ts` + error codes | Build passes |
| WP-A3 | `/admin` overview | Tiles show real numbers |
| WP-A4 | Students list, create, detail, consent | Create student → grant consent → visible in the list |
| WP-A5 | Enrolment flow + fingerprint deletion (live command tracking) | Enrol with `fake_terminal next` / `result ok` → the page shows "Enrolled" without a manual refresh |
| WP-A6 | Courses list/detail, lecturer assignment, roster add/remove | The lecturer sees the newly assigned course on their side |
| WP-A7 | Terminals list, add terminal (one-time secret), activate/deactivate, command history | A new terminal's secret works with `fake_terminal` |
| WP-A8 | Users list, add user, (P2) edit role/active, reset password | A new lecturer can log in |
| WP-A9 | Audit log page | Every action from the §9 demo appears |
| WP-A10 | P2 extras: CSV import, rotate secret, cancel command, edit student, deactivate student | §9 demo extras |

---

## 2. WP-A1 — Single login, role routing, guards, navigation

These **edit existing Phase 1 files**. Change only the lines needed, following the comment/style rule.

### 2.1 `lib/auth.tsx`

Add `homeFor(role: Role): string` → `"/admin"` for admin, `"/lecturer"` for lecturer. Export it.

### 2.2 `app/login/page.tsx`

After a successful login, use `router.replace(homeFor(user.role))`. An already-logged-in user also redirects to `homeFor(user.role)`.

Support `?next=/some/path`. If it's present **and** the user's role may access it (§2.4), go there instead. Only accept paths starting with `/` and not `//` (this prevents open redirects).

Copy stays neutral: title "Biometric Attendance", subtitle "Staff sign in", and the helper text "Administrators and lecturers use the same sign-in." No role selector.

### 2.3 `app/page.tsx`

Logged in → `homeFor(user.role)`; otherwise → `/login`.

### 2.4 Guards

- `components/require-auth.tsx` already accepts `roles?: Role[]`. Change the wrong-role behaviour: instead of an empty state, run `toast.error("You don't have access to the admin area.")` and then `router.replace(homeFor(user.role))`. Render nothing while redirecting.
- Not logged in → `router.replace("/login?next=" + encodeURIComponent(pathname))`.
- Create `src/app/(app)/admin/layout.tsx` = `<RequireAuth roles={["admin"]}>{children}</RequireAuth>`. The shell is already provided by `(app)/layout.tsx`, so don't wrap it twice.
- The lecturer area stays open to both roles.

### 2.5 Navigation (`components/nav-links.tsx`)

**Admin:**
- **Administration:**
  - Overview `/admin` (`LayoutDashboard`)
  - Students `/admin/students` (`Users`)
  - Courses `/admin/courses` (`BookOpen`)
  - Terminals `/admin/devices` (`Cpu`)
  - Staff accounts `/admin/users` (`ShieldCheck`)
  - Audit log `/admin/audit` (`ScrollText`)
- **Teaching:**
  - Sessions `/lecturer` (`CalendarCheck`)
  - Reports `/lecturer/courses` (`BarChart3`)
- **Bottom:** Account `/account`

**Lecturer:** unchanged from Phase 1 (Sessions, Courses, Account).

The user menu shows a role badge ("Admin" / "Lecturer"). For admins, the top bar shows a small "Admin" pill next to the app name so it's always clear which mode you're in.

### 2.6 Lecturer pages viewed by an admin

No code change is needed: the backend returns all courses to admins. On `/lecturer`, admins see the subtitle "Viewing all courses (administrator)".

---

## 3. WP-A2 — Shared building blocks

### 3.1 Components (`src/components/admin/` unless noted)

| Component | Purpose |
|---|---|
| `components/data-table.tsx` | Generic table. Props: columns `{ key, header, cell(row), className?, sortable? }[]`, rows, loading (skeleton rows), empty (node), onRowClick. Wraps the shadcn Table in `overflow-x-auto`. |
| `components/pagination-bar.tsx` | Props `total, limit, offset, onChange`. Shows "Showing 1–50 of 132" with Previous/Next. |
| `components/confirm-dialog.tsx` | AlertDialog wrapper. Props: title, description (node), confirmLabel, destructive?, requireText? (the user must type e.g. the student number to enable confirm), onConfirm (async, spinner). |
| `components/copy-button.tsx` | Copies to the clipboard, swaps to a check icon for 2 s, has an aria-label. |
| `components/json-view.tsx` | Pretty-prints audit `details` in a `<pre>`; collapsible. |
| `consent-badge.tsx` | "Consent given" (emerald, `ShieldCheck`) / "No consent" (slate, `ShieldOff`). Tooltip shows `consent_at`. |
| `command-status-badge.tsx` | pending = slate "Waiting for terminal"; in_progress = blue "On terminal now" with pulsing dot; done = emerald "Done"; failed = red "Failed"; expired = amber "Expired"; cancelled = slate outline "Cancelled". |
| `command-type-label.tsx` | enrol → "Enrol fingerprint" (`Fingerprint`); delete_slot → "Wipe slot" (`Eraser`). |
| `online-dot.tsx` | Online (emerald dot + "Online") / Offline (slate + "Offline · last seen 5 min ago" or "never"). |
| `active-badge.tsx` | Active / Inactive. |
| `search-input.tsx` | Debounced 300 ms input. Writes `?q=` to the URL and resets `offset` to 0. |

### 3.2 URL state

List pages keep filters and pagination in the query string (`q`, `course`, `active`, `role`, `offset`, `tab`) using `useSearchParams` + `router.replace`, so refresh and back keep the view. Default `limit` is 50.

### 3.3 `lib/api.ts` — small extension

`ApiError` gets `extra?: Record<string, unknown>` holding any other keys from the JSON error body. The CSV import returns `{"detail": "bad_csv", "row": 7}` and the UI needs `row`.

Add `apiUpload<T>(path, file: File, token)`, which posts `FormData` with field name **`file`** and does **not** set `Content-Type` (the browser sets the multipart boundary).

### 3.4 `lib/types.ts` — append (exact mirror of `Backend/app/schemas/admin.py`)

```ts
export type CommandType = "enrol" | "delete_slot";                                                  // terminal command kinds
export type CommandStatus = "pending" | "in_progress" | "done" | "failed" | "cancelled" | "expired"; // command life cycle

export interface UserCreate { email: string; full_name: string; role: Role; password: string; }      // POST /admin/users (password ≥ 8)
export interface UserUpdate { full_name?: string; role?: Role; is_active?: boolean; }                // PATCH /admin/users/{id}
export interface PasswordResetIn { new_password: string; }                                            // POST /admin/users/{id}/reset-password

export interface StudentCreate { student_number: string; full_name: string; }                         // number: 6–12 digits
export interface StudentUpdate { full_name?: string; is_active?: boolean; }                           // PATCH /admin/students/{id}
export interface ConsentUpdate { consent: boolean; }                                                  // PUT /admin/students/{id}/consent
export interface EnrolIn { device_id: number; }                                                        // POST /admin/students/{id}/enrol
export interface StudentOut {                                                                          // student in lists
  id: number; student_number: string; full_name: string; is_active: boolean;
  biometric_consent: boolean; consent_at: string | null; enrolled_device_ids: number[];
}
export interface CourseBrief { id: number; code: string; name: string; }                              // course reference
export interface SlotOut { device_id: number; device_name: string; slot_number: number; }             // fingerprint location
export interface CommandOut {                                                                          // queued terminal command
  id: number; device_id: number; type: CommandType; status: CommandStatus; slot_number: number;
  student_id: number | null; student_number: string | null; created_at: string;
  expires_at: string | null; completed_at: string | null; result_detail: string | null;
}
export interface StudentDetail extends StudentOut { courses: CourseBrief[]; fingerprint_slots: SlotOut[]; open_commands: CommandOut[]; } // detail

export interface CourseCreate { code: string; name: string; }                                         // code stored upper-case
export interface CourseUpdate { name?: string; is_active?: boolean; }                                 // PATCH /admin/courses/{id}
export interface LecturersSet { user_ids: number[]; }                                                  // replaces the whole set
export interface StudentsAdd { student_numbers: string[]; }                                            // 1–500 numbers
export interface RosterChange { added: string[]; already_present: string[]; unknown: string[]; }      // add result
export interface RosterImportOut extends RosterChange { created: string[]; }                           // CSV import result
export interface CourseDetail extends CourseOut { lecturers: UserOut[]; students: StudentOut[]; }      // course detail

export interface DeviceCreate { name: string; }                                                        // POST /admin/devices
export interface DeviceUpdate { is_active?: boolean; }                                                 // PATCH /admin/devices/{id}
export interface DeviceOut {                                                                           // terminal (never the secret)
  id: number; name: string; is_active: boolean; last_seen_at: string | null; online: boolean;
  open_session_id: number | null; enrolled_count: number; pending_commands: number;
}
export interface DeviceCreated extends DeviceOut { hmac_secret: string; }                              // create/rotate only

export interface AuditOut {                                                                            // audit row
  id: number; created_at: string; actor_user_id: number | null; actor_name: string | null;
  action: string; entity: string; entity_id: string; details: Record<string, unknown>;
}
```

(`Role`, `UserOut`, `CourseOut` and `Page<T>` already exist from Phase 1.)

### 3.5 Admin endpoints (all need an admin token)

| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/admin/users` | `role?, search?, limit, offset` | `Page<UserOut>` |
| POST | `/admin/users` | `UserCreate` | 201 `UserOut` |
| PATCH | `/admin/users/{id}` | `UserUpdate` | `UserOut` |
| POST | `/admin/users/{id}/reset-password` | `PasswordResetIn` | 204 |
| GET | `/admin/students` | `search?, course_id?, active?, limit, offset` | `Page<StudentOut>` (alphabetical) |
| POST | `/admin/students` | `StudentCreate` | 201 `StudentOut` (consent false) |
| GET | `/admin/students/{id}` | | `StudentDetail` |
| PATCH | `/admin/students/{id}` | `StudentUpdate` (deactivating also deletes biometrics) | `StudentOut` |
| PUT | `/admin/students/{id}/consent` | `ConsentUpdate` (false = withdraw + delete biometrics on all terminals) | `StudentOut` |
| POST | `/admin/students/{id}/enrol` | `EnrolIn` | 201 `CommandOut` |
| DELETE | `/admin/students/{id}/fingerprints` | `device_id?` (omit = all terminals) | `CommandOut[]` (queued wipes) |
| GET | `/admin/courses` | `active?` | `CourseOut[]` |
| POST | `/admin/courses` | `CourseCreate` | 201 `CourseOut` |
| GET | `/admin/courses/{id}` | | `CourseDetail` |
| PATCH | `/admin/courses/{id}` | `CourseUpdate` | `CourseOut` |
| PUT | `/admin/courses/{id}/lecturers` | `LecturersSet` | `CourseDetail` |
| POST | `/admin/courses/{id}/students` | `StudentsAdd` | `RosterChange` |
| DELETE | `/admin/courses/{id}/students/{student_id}` | | 204 |
| POST | `/admin/courses/{id}/students/import` | multipart `file` (CSV, header `student_number,full_name`) | `RosterImportOut` or 400 `{detail:"bad_csv", row}` |
| GET | `/admin/devices` | | `DeviceOut[]` |
| POST | `/admin/devices` | `DeviceCreate` | 201 `DeviceCreated` |
| PATCH | `/admin/devices/{id}` | `DeviceUpdate` | `DeviceOut` |
| POST | `/admin/devices/{id}/rotate-secret` | | `DeviceCreated` |
| GET | `/admin/devices/{id}/commands` | `status?, limit, offset` | `Page<CommandOut>` (newest first) |
| POST | `/admin/commands/{id}/cancel` | | `CommandOut` |
| GET | `/admin/audit` | `action?` (prefix), `entity?`, `actor_user_id?`, `since?`, `until?` (ISO with offset), `limit, offset` | `Page<AuditOut>` (newest first) |

Admins may also call every `/lecturer/*` endpoint (Phase 1 hooks).

### 3.6 `lib/query-keys.ts` — add

```ts
  adminStudents: (f: object) => ["admin", "students", f] as const,     // student lists
  adminStudent: (id: number) => ["admin", "student", id] as const,      // student detail
  adminCourses: (f: object) => ["admin", "courses", f] as const,        // course lists
  adminCourse: (id: number) => ["admin", "course", id] as const,        // course detail
  adminDevices: ["admin", "devices"] as const,                          // terminals
  adminDeviceCommands: (id: number, f: object) => ["admin", "device-commands", id, f] as const, // command history
  adminUsers: (f: object) => ["admin", "users", f] as const,            // staff accounts
  adminAudit: (f: object) => ["admin", "audit", f] as const,            // audit log
```

### 3.7 `hooks/use-admin.ts`

One hook per endpoint in §3.5. Invalidation rules:

- **student create/update/consent/enrol/delete-fingerprints** → invalidate `["admin","students"]`, `adminStudent(id)` and `adminDevices`. For consent/enrol/delete, also invalidate `["admin","device-commands"]`.
- **course create/update/lecturers/students add/remove/import** → invalidate `["admin","courses"]`, `adminCourse(id)` and `["lecturer","courses"]`. Roster changes also invalidate `["admin","students"]`.
- **device create/update/rotate/cancel** → invalidate `adminDevices` and `["admin","device-commands"]`.
- **user create/update/reset** → invalidate `["admin","users"]`.

`onError` → `toast.error(errorMessage(err))`, except where §5–§8 say to show the error inline.

### 3.8 `lib/errors.ts` — add these codes

| code | Message |
|---|---|
| `email_taken` | An account with that email already exists. |
| `user_not_found` | Account not found. |
| `cannot_modify_self` | You can't change your own role or deactivate yourself. |
| `last_admin` | There must always be at least one active administrator. |
| `student_number_taken` | A student with that number already exists. |
| `student_not_found` | Student not found. |
| `student_inactive` | This student is deactivated. Reactivate them first. |
| `no_consent` | Record biometric consent before enrolling a fingerprint. |
| `already_enrolled` | This student's fingerprint is already on that terminal. |
| `enrolment_pending` | An enrolment for this student is already waiting on that terminal. |
| `sensor_full` | That terminal's fingerprint sensor is full. |
| `device_not_found` | Terminal not found. |
| `device_inactive` | That terminal is deactivated. |
| `device_name_taken` | A terminal with that name already exists. |
| `course_code_taken` | A course with that code already exists. |
| `course_not_found` | Course not found. |
| `not_a_lecturer` | Only active lecturer accounts can be assigned to a course. |
| `not_on_roster` | That student isn't on this course's class list. |
| `bad_csv` | The CSV file has a problem on row {row}. Expected columns: student_number,full_name. |
| `unknown_command` | Command not found. |
| `command_not_active` | That command has already finished. |
| `wipe_cannot_be_cancelled` | Fingerprint deletions can't be cancelled (POPIA). |

`errorMessage` substitutes `{row}` from `err.extra.row`.

---

## 4. WP-A3 — `/admin` Overview

**Header:** "Administration" plus "Good morning, <first name>".

**Tiles** (4 across, 2×2 on mobile), each clickable to its page:

| Tile | Source | Display |
|---|---|---|
| Students | `GET /admin/students?limit=1` → `total`; `GET /admin/students?active=true&limit=200` → count `!biometric_consent` | "132 students", sub-line "18 without biometric consent". If the total is over 200, show the sub-line as "18+ without consent". |
| Courses | `GET /admin/courses?active=true` | "4 active courses" |
| Terminals | `GET /admin/devices` | "1 / 2 online", sub-line "3 commands waiting" (sum of `pending_commands`). Amber if any active terminal is offline. |
| Sessions running | `GET /lecturer/sessions?open_only=true&limit=1` → `total` | "1 running now" (links to `/lecturer`) |

**Panels below:**
- **"Needs attention"** list, each item linking to the place to fix it:
  - active terminals offline for more than 5 minutes;
  - commands with status `failed` or `expired` in the last 24 h (from each device's `/commands?limit=20`);
  - courses with no lecturer (`lecturer_count === 0`) or no students (`student_count === 0`).
  - Empty state: "All good."
- **"Recent activity":** `GET /admin/audit?limit=10`, showing time, actor, and a human sentence from the action label map (§8.2). Link "View audit log".

Refresh: devices every 15 s; the rest on window focus.

---

## 5. WP-A4 / WP-A5 — Students, consent, enrolment

### 5.1 `/admin/students` — list

- **Toolbar:**
  - `SearchInput` ("Search by number or name");
  - Course `Select` ("All courses", options from `GET /admin/courses`);
  - Status `Select` (Active [default] / Inactive / All);
  - Primary button **"Add student"**.
- **Table columns:**
  - Student number (monospace);
  - Name;
  - Consent (`ConsentBadge`);
  - Fingerprint: device name chips from `enrolled_device_ids`, mapped through the devices list; "Not enrolled" in muted text if empty;
  - Status (`ActiveBadge`, only when the "All" filter is on);
  - chevron.
- Row click → `/admin/students/[id]`. Pagination at 50 per page.
- **"Add student" dialog:**
  - Fields: student number (6–12 digits; zod regex `^[0-9]{6,12}$`) and full name (1–120).
  - Optional checkbox "Add to course" with a course select. After creating, it also calls `POST /admin/courses/{id}/students` with that number.
  - On success: toast "Student added", close, then navigate to the detail page (so consent and enrolment are the next obvious steps).
  - `student_number_taken` shows inline on the field.

### 5.2 `/admin/students/[id]` — detail

Read the id with `useParams()`. Data comes from `useAdminStudent(id)`. While `open_commands.length > 0`, poll **every 2 s**; otherwise don't poll.

**Header:**
- Name, student number, `ActiveBadge`, `ConsentBadge`.
- Actions (P2): "Edit name" and "Deactivate"/"Reactivate".
- Deactivate confirm: "Deactivating removes <name> from attendance and deletes their fingerprints from all terminals. Their past attendance records are kept."

**Card 1 — Biometric consent (POPIA):**
- Status line: "Consent given on 20 Oct 2026, 09:05" or "No consent recorded".
- **Grant** (consent is false):
  - Button "Record consent".
  - Dialog with a required checkbox: "I confirm the student signed the biometric consent form."
  - Then `PUT /consent {consent:true}`.
- **Withdraw** (consent is true):
  - Button "Withdraw consent" (destructive outline).
  - `ConfirmDialog` with `requireText` = the student number. Description: "This deletes <name>'s fingerprint from every terminal and stops biometric attendance. They can still be marked present manually by a lecturer. This is recorded in the audit log."
  - Then `PUT /consent {consent:false}`.
  - Afterwards, show the queued wipes in Card 3.
- Info text: "Students who don't consent can always be marked present manually by their lecturer."

**Card 2 — Fingerprints:**
- Table of `fingerprint_slots`: Terminal, Slot #, and a "Delete" action per row.
- **"Enrol on a terminal"** button:
  - Disabled with a tooltip when there's no consent ("Record consent first") or the student is inactive.
  - Opens the `EnrolDialog` (§5.3).
- **"Delete all fingerprints"** button (only if there are slots): `ConfirmDialog` → `DELETE /fingerprints` (no `device_id`).
- Per-row delete: confirm → `DELETE /fingerprints?device_id=X`.
- After deletion, toast "Fingerprint deleted. The terminal will wipe slot N next time it checks in."

**Card 3 — Terminal activity (`open_commands`):**
- Each open command is a row: `CommandTypeLabel`, terminal name, slot, `CommandStatusBadge`, "queued 1 min ago", and for an enrol a countdown to `expires_at` ("expires in 8:42").
- P2: a "Cancel" button on enrol commands (confirm). Never on wipes: those show the tooltip "Deletions can't be cancelled".
- When a command leaves the open list, show its final result via §5.3's tracking logic. Keep the last 5 finished commands from this page session visible with their final badges.
- Empty state: "No pending terminal activity."

**Card 4 — Courses:** chips for `courses` (code + name), each linking to `/admin/courses/[id]`. If empty: "Not on any class list. Add the student from a course page."

### 5.3 `EnrolDialog` and live tracking (the key UX)

**Step 1 — choose a terminal:**
- Radio list from `GET /admin/devices` (active ones only).
- Each option: name, `OnlineDot`, "x enrolled".
- Disabled when the student is already enrolled there ("Already enrolled") or `pending_commands` shows a pending enrol for this student (check `open_commands`).
- If the chosen terminal is offline, show a warning: "This terminal isn't online. The enrolment will wait up to 10 minutes for it to check in."
- Button **"Send to terminal"** → `POST /admin/students/{id}/enrol`. Errors `no_consent`, `already_enrolled`, `enrolment_pending`, `sensor_full` and `device_inactive` show inline in the dialog.

**Step 2 — live progress** (same dialog; it can't close accidentally while in progress, though there's an explicit "Close, keep waiting in background" link):
- Keep `commandId` and `deviceId` from the response.
- Poll `GET /admin/devices/{deviceId}/commands?limit=20` **every 2 s** and find the row with `id === commandId`. Also refetch the student detail.
- Show a 3-step progress indicator:
  1. **Queued** — "Waiting for <terminal> to check in…" (`pending`)
  2. **On terminal** — "Ask <first name> to place their finger on <terminal> when the screen shows their name." (`in_progress`)
  3. **Result** — one of:
     - `done` → green check, "Fingerprint enrolled in slot N", button "Done";
     - `failed` → red, `result_detail` (e.g. "student_already_enrolled", or a sensor error from the terminal), button "Try again" (back to step 1);
     - `expired` → amber, "The terminal didn't finish in time", "Try again";
     - `cancelled` → slate, with the reason (`consent_withdrawn` / `biometrics_deleted` / `cancelled_by_admin`).
- Stop polling on any final status or when the dialog unmounts.
- Show the `expires_at` countdown.

---

## 6. WP-A6 — Courses and class lists

### 6.1 `/admin/courses` — list

- Toolbar: Status `Select` (Active [default] / Archived / All → `active=true|false|omit`) and **"New course"**.
- Table: Code (bold), Name, Lecturers (count; amber "None" if 0), Students (count; amber "Empty" if 0), Status. Row → detail.
- **"New course" dialog:**
  - Code (1–20; auto upper-case as you type; no spaces at the start or end).
  - Name (1–120).
  - Error `course_code_taken` shows inline.
  - On success, go to the detail page.

### 6.2 `/admin/courses/[id]` — detail

**Header:**
- Code, name, status.
- Actions (P2): "Rename" and "Archive"/"Restore". Archive confirm: "Lecturers won't be able to open new sessions for this course. Existing records are kept."

**Card — Lecturers:**
- Chips of the current lecturers (name + email).
- **"Edit lecturers"** → dialog with a searchable checkbox list from `GET /admin/users?role=lecturer&limit=200`. Inactive users are excluded; if a current lecturer is inactive, show them disabled with an "Inactive" note.
- Save → `PUT /lecturers {user_ids}` (the full set). `not_a_lecturer` shows inline.
- Hint text: "Lecturers only see courses they're assigned to."

**Card — Class list** (from `students` in the course detail):
- **Toolbar:**
  - client-side search;
  - **"Add students"**: dialog with a textarea "One student number per line, or separated by commas". Parse, dedupe, validate digits client-side, then `POST /students {student_numbers}`;
  - (P2) **"Import CSV"** (§6.3).
- **Result panel after adding** (stays on the page until dismissed):
  - "Added 12" (green);
  - "Already on the list 3" (slate);
  - "Unknown numbers 2" (amber), listing them, with a "Create these students" link to `/admin/students` and the Add dialog.
- **Table:**
  - Student number;
  - Name;
  - Consent;
  - Fingerprint (enrolled or not);
  - Remove action: confirm "Remove <name> from <code>? Their past attendance in this course is kept." → `DELETE /students/{student_id}` (204).
- **Summary line:** "60 students · 48 with consent · 45 enrolled". This tells the admin who still needs enrolling. Add a filter tab "Not enrolled".

### 6.3 CSV import (P2)

- Dialog with a file picker (`.csv`) and an expected-format example plus a "Download template" link. The template is generated client-side: `student_number,full_name\n220000004,Example Name`.
- Upload with `apiUpload('/admin/courses/{id}/students/import', file)`.
- **Success:** a result panel like §6.2 plus "Created 5 new students (consent not yet recorded)".
- **400 `bad_csv`:** show an inline error with the row number. Explain the import is all-or-nothing: "Nothing was imported. Fix row 7 and try again."

---

## 7. WP-A7 — Terminals

### 7.1 `/admin/devices`

Poll the list every 10 s.

- Header button **"Add terminal"**.
- Table:
  - Name;
  - `OnlineDot` (online/offline + last seen relative);
  - Status (Active/Inactive);
  - Session ("Running" link to `/lecturer/sessions/{open_session_id}`, or "—");
  - Enrolled (count);
  - Waiting commands (count; blue if > 0);
  - Actions menu: View commands, Rotate secret (P2), Deactivate/Activate.
- **Deactivate** confirm: "The terminal will be rejected immediately (attendance, enrolment and wipes stop until reactivated). Its stored fingerprint mappings are kept."
- **"Add terminal" dialog:** name (1–50, e.g. "terminal-02"). `device_name_taken` shows inline. On success, open the `SecretDialog`.
- **`SecretDialog`** (used for create and rotate):
  - Shows `DEVICE_ID = <id>` and `DEVICE_SECRET = <hmac_secret>` in monospace boxes, each with a `CopyButton`.
  - A "Copy both as config" button copies:
    ```
    DEVICE_ID=3
    DEVICE_SECRET=ab12…
    ```
  - Warning (amber): "Copy this into the terminal firmware now. For security it will never be shown again."
  - The close button only enables after a checkbox "I've saved the secret" is ticked.
  - On close, clear the secret from component state.
- **Rotate secret (P2):** confirm "The terminal will stop working until you flash the new secret onto it." → `POST /rotate-secret` → `SecretDialog`.

### 7.2 Command history (drawer or `/admin/devices/[id]`)

- `GET /admin/devices/{id}/commands`, newest first, paginated; status filter tabs: All, Open (client-side: pending + in_progress), Failed, Done.
- Columns:
  - Type;
  - Student number (links to the student when `student_id` exists);
  - Slot;
  - Status;
  - Queued;
  - Completed;
  - Detail (`result_detail`);
  - (P2) Cancel on open enrol commands.
- Poll every 3 s while any command is open.

---

## 8. WP-A8 / WP-A9 — Staff accounts and audit log

### 8.1 `/admin/users`

- Toolbar: search, Role `Select` (All / Admin / Lecturer), and **"Add staff account"**.
- Table: Name, Email, Role badge, Status, Created, Actions menu.
- Actions menu (P2):
  - Change role;
  - Deactivate/Activate;
  - Reset password.
  - Your own row shows "(you)" and has role/deactivate disabled with the tooltip "You can't change your own role or deactivate yourself."
- **"Add staff account" dialog:**
  - Email.
  - Full name.
  - Role: radio "Lecturer" (default) / "Administrator".
  - Temporary password (≥ 8) with a "Generate" button: 12 random chars from `crypto.getRandomValues`, plus show/copy.
  - Helper: "Share the temporary password with the person securely. They can change it under Account."
  - `email_taken` shows inline.
  - If the role is lecturer, after creating offer "Assign to courses now?", which opens a course multi-select. For each selected course, `PUT /admin/courses/{id}/lecturers` with existing IDs + the new one (fetch the course detail first).
- **Change role / deactivate:** confirm. `cannot_modify_self` and `last_admin` are shown as friendly errors.
- **Reset password:** dialog with a new password (≥ 8, Generate button) → 204 → toast "Password reset".

### 8.2 `/admin/audit` (read-only)

- **Filters:**
  - Category `Select` → `action` prefix: All, Attendance (`attendance.`), Fingerprints (`fingerprint.`), Consent (`consent.`), Sessions (`session.`), Courses (`course.`), Students (`student.`), Terminals (`device.`), Accounts (`user.` plus `auth.`; run two queries or allow "All" only — keep it simple: "Accounts" uses `user.`);
  - Actor `Select` from `GET /admin/users?limit=200`;
  - Date range: "From" and "To" date inputs. Convert to ISO with the SAST offset: start of day `T00:00:00+02:00` and end of day `T23:59:59+02:00` → `since` / `until`.
- **Table:** Time (date-time), Actor (`actor_name` or "System / terminal"), Action (a human label from the map below plus the raw action code in small muted text), Target (`entity #entity_id`, linked when it's a student/course/session), and an expand toggle that reveals `JsonView` of `details`.
- **Human labels:**
  - `attendance.manual` "Marked present manually"
  - `attendance.revoked` "Revoked attendance"
  - `attendance.reinstated` "Reinstated attendance"
  - `attendance.exported` "Exported attendance CSV"
  - `fingerprint.enrol_requested` "Requested fingerprint enrolment"
  - `fingerprint.enrolled` "Fingerprint enrolled"
  - `fingerprint.deleted` "Deleted fingerprints"
  - `fingerprint.slot_wiped` "Terminal wiped a slot"
  - `consent.granted` "Recorded consent"
  - `consent.withdrawn` "Withdrew consent"
  - `session.opened` / `session.closed`
  - `course.*`, `student.*`, `device.*`, `user.*`, `auth.password_changed` — label each sensibly.
  - Unknown action → show the raw code.
- **Pagination:** 50 per page.
- A banner explains: "The audit log is append-only. Entries can't be edited or deleted."
- **No** edit/delete controls anywhere.

---

## 9. Demo script (acceptance for the admin side)

Preparation: backend running (`fastapi dev app/main.py` from `Backend`), `python -m scripts.seed` done, frontend `npm run dev`.

1. Open http://localhost:3000 and log in as **`admin@tut.ac.za`** / `ChangeMe123`. You land on **/admin**, where the tiles show students, courses, terminals and sessions.
2. **Courses → New course** "PD2316E — Project Design Demo". In **Edit lecturers**, assign the demo lecturer.
3. **Students → Add student** `220000010` "Demo Student", ticking "Add to course PD2316E". You land on the detail page, which shows "No consent".
4. **Record consent** (tick the form checkbox). The badge turns green.
5. **Enrol on a terminal** → terminal-01 → **Send to terminal**. The dialog shows "Waiting for terminal-01…".
6. In a terminal window: `python -m scripts.fake_terminal next` → the dialog switches to **"On terminal"** within about 2 s. Then `python -m scripts.fake_terminal result <command_id> ok` → the dialog shows **"Fingerprint enrolled in slot N"**. The Fingerprints card lists terminal-01 / slot N.
7. **Terminals:** terminal-01 shows Online, enrolled count +1, 0 waiting.
8. Log out, then log in as **`lecturer@tut.ac.za`** on the **same login page**. You land on **/lecturer** and PD2316E is available when opening a session. Typing `/admin/students` in the address bar redirects back to `/lecturer` with the "no access" toast.
9. Log back in as admin. On the student detail, **Withdraw consent** (type the student number to confirm). Card 3 shows "Wipe slot N — Waiting for terminal". Run `fake_terminal next`, then `result <id> ok` → it shows Done.
10. **Terminals → Add terminal** "terminal-02". The one-time secret dialog appears. Copy the values into `$env:DEVICE_ID` / `$env:DEVICE_SECRET` and run `fake_terminal session` → `no_open_session` (404). This proves the new secret authenticates.
11. **Staff accounts → Add staff account** (lecturer, generated password). Log in as them, and they see only assigned courses.
12. **Audit log:** every step above appears with human labels. Filter "Fingerprints" shows only the enrol/delete/wipe entries.

---

## 10. Definition of done (admin side)

- [ ] One `/login` page; admin → `/admin`, lecturer → `/lecturer`; `?next=` works and is safe.
- [ ] `/admin/**` is inaccessible to lecturers (redirect + toast); admins can use the lecturer pages.
- [ ] Every A-P1 page works against the real backend; the §9 demo passes end to end.
- [ ] Every destructive or privacy action has a confirmation that says exactly what happens; consent withdrawal requires typing the student number.
- [ ] The enrolment dialog updates live without a manual refresh, and stops polling at a final status.
- [ ] The device secret appears only in the one-time dialog and is cleared on close.
- [ ] The audit page has no edit/delete controls.
- [ ] All new error codes have friendly messages; inline errors where specified.
- [ ] Usable at 375 px; light and dark mode; `npm run lint` + `npm run build` green; no `any`; code commented per the owner's rule.
- [ ] `Frontend\README.md` updated: seed accounts for both roles, and how to demo the enrolment flow with `fake_terminal`.
