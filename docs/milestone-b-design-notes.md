# Milestone B — design document updates and review notes

Part 1 is the text to carry into `design-document.pdf` (spec §12 / B10).
Part 2 lists every judgment call made while implementing, for review before you commit.

---

## Part 1 — Design document updates (B10)

### 1. Attendance API constraints

Replace "role-based access for student, lecturer, and administrator functions" with:

> Role-based access for lecturer and administrator functions. Students interact only through the terminal and never log in.

### 2. F1 Student Enrolment

> An administrator starts the enrolment from the dashboard. The server checks that the student is active and has given biometric consent. It then assigns the lowest free sensor slot on the chosen terminal and queues an `enrol` command, which stays valid for 10 minutes. The terminal polls `GET /device/commands/next` every ~3 s. It shows "Enrol: <name>" on the LCD, captures the finger into exactly the slot it was given, and reports the outcome with `POST /device/commands/{id}/result`. The server records the slot → student mapping only after the terminal confirms. Biometric deletion uses the same queue: a `delete_slot` command never expires and cannot be cancelled. This replaces terminal-side identity entry, since the terminal has no keypad.

### 3. Data model

> New tables:
> - `courses`
> - `course_lecturers` (many-to-many)
> - `course_students` (class list)
> - `device_commands` (enrol / delete_slot queue with a pending → in_progress → done / failed / cancelled / expired life cycle)
>
> New fields:
> - `students.is_active`
> - on `attendance`: `recorded_by_user_id`, `note`, `revoked_at`, `revoked_by_user_id`, `revoke_reason`
>
> `sessions.course_code` is replaced by `sessions.course_id`. A scan from a student who is not on the course's class list is rejected with `not_in_course`. Reports therefore show both present and absent students, which enforces the "enrolment capped to one class" constraint.

### 4. F5 Corrections

> Lecturers correct records on the dashboard and must always give a reason (3–255 characters). Manual marking is the POPIA non-biometric fallback and does not need biometric consent. It is allowed on open and closed sessions, but only for students on the course roster.
>
> Corrections never delete anything:
> - **Revoke** sets `revoked_at`, `revoked_by_user_id` and `revoke_reason`. The row stays, and it no longer counts as present.
> - **Reinstate** happens when a lecturer manually marks a revoked student again. It clears the revocation on the *same* row.
>
> A fingerprint scan never re-activates a revoked record. Every correction writes an append-only audit entry with before/after values, in the same database transaction.

### 5. RTM — new rows

| Requirement | Verified by |
|---|---|
| Login and role-based access (admin / lecturer only) | `tests/test_auth.py` (all), `test_role_guards` |
| Lecturers see only their own courses (404, not 403) | `tests/test_lecturer.py::test_other_lecturer_gets_404`, `test_course_visibility` |
| Roster enforcement on the terminal | `tests/test_device.py::test_student_not_on_roster_is_rejected` |
| POPIA consent withdrawal unlinks and wipes the template | `tests/test_device_commands.py::test_consent_withdrawn_after_enrolment_wipes_slot` (spec test #8), `tests/test_admin.py::test_consent_grant_and_withdrawal` |
| Wipe commands cannot be cancelled | `tests/test_device_commands.py::test_wipe_cannot_be_cancelled` |
| Audit log is append-only (no write routes) | `tests/test_admin.py::test_audit_list` (spec test #7) |
| Corrections are soft and audited (revoke / reinstate) | `tests/test_lecturer.py::test_revoke_and_reinstate`, `tests/test_device.py::test_revoked_record_is_not_reactivated_by_scan` |

---

## Part 2 — Implementation notes for review

### Status

- `python -m pytest -q`: **56 passed**. That is the 9 Milestone A tests, with the enrol-dependent ones rewritten as the spec asks, plus 47 new tests.
- `alembic upgrade head` → `downgrade -1` → `upgrade head` worked on the dev DB. Seed session 1 got `course_id = 1` (PD2316D).
- The §10.4 walkthrough ran end to end against your running `fastapi dev` server. All 10 steps passed: enrol → slot 1, scan recorded, 1 present / 2 absent, manual mark, revoke, CSV export, consent withdrawal → `delete_slot` → done, and audit trail complete.
- **Dev DB state after the walkthrough:**
  - Session 1 is closed and session 2 is open on terminal-01 ("Building 10, Room 112").
  - 220000001 was enrolled and then wiped. Its consent was re-granted afterwards, but it has **no slot** now.
  - The 220000003 manual record is revoked.

### Additions beyond the §11.3 file list

All additions; no existing file was split or renamed beyond what the spec required.

- `app/services/views.py`: builds response shapes (counts, online flag, names) with batched queries, so routers stay thin.
- `app/services/attendance.py`: roster view, manual mark / reinstate, revoke, CSV export, course report.
- `app/routers/common.py`: shared `DbSession`, pagination (`limit` / `offset`) and the `Page` query helper.
- `app.auth.verify_password()`: used by change-password.

### Judgment calls (please confirm or overrule)

1. **Half-done enrolments get wiped.** An `enrol` command can be cancelled or expire *after* the terminal claimed it (`in_progress`). In that case the server also queues a `delete_slot` for that slot, because the sensor may already hold the template (POPIA). The spec only says to cancel or expire.
2. **Results after the deadline count as expired.** `POST /device/commands/{id}/result` runs `expire_stale` first, so a result that arrives after the deadline gets `409 command_not_active` instead of being accepted.
3. **Inactive students and manual marks.** Manual mark of an inactive student returns `400 student_inactive`. The code exists in §11.1, but §8 doesn't list it for that endpoint.
4. **`GET /lecturer/courses`** returns only *active* assigned courses for lecturers (admins get all active courses). Archived courses are still reachable by ID for reports.
5. **`last_admin` cannot be reached through the API.** Deactivating or demoting admin X needs a *different* active admin, and `cannot_modify_self` blocks the only other path. The guard stays as defence in depth and is unit-tested by calling the endpoint function directly.
6. **CSV import errors** come back as `400 {"detail": "bad_csv", "row": n}`. Rows are numbered as Excel shows them, with the header as row 1.
7. **Course codes** must contain a non-space character; otherwise the request fails with 422.
8. **Race windows** (single-admin assumption): `device_busy` and slot allocation are checked in code, with no database constraint behind them. If needed later, a partial unique index on `sessions(device_id) WHERE closed_at IS NULL` would close the first.
9. **Test fixtures.** `world` now uses the `lecturer_user` fixture (`lecturer@tut.ac.za`) instead of `l@test`. `test_no_consent_cannot_enrol` now calls the admin enrol endpoint, because `/device/enrolments` was removed.
10. **Seed data.** The migration backfill created course PD2316D named "PD2316D", and the seed renames it to "Project Design III". The old `lecturer@demo.local` stays assigned to PD2316D through the backfill (harmless, as the spec says).
11. **`.env` / `.env.example`.** The five new keys were appended to `.env`, and `.env.example` now lists every key with placeholder secrets. `Backend/requirements.txt` was regenerated with `pip freeze`. All B0 packages were already installed.

### Open questions for you

- There is a nested `Biometrics Project folder\Biometrics Project folder\` containing its own `.git`, `README.md` and `.gitattributes`, dated 22:22 today, before this work started. Is that your GitHub clone? If so, the Backend code you'll commit lives one level up, outside that repo.
- Opening the CSV in Excel (walkthrough step 8) is the one check that needs your eyes.
