// TypeScript mirrors of the FastAPI response/request shapes (Backend/app/schemas/*).
// Datetimes arrive as ISO 8601 strings. If anything here disagrees with
// http://127.0.0.1:8000/openapi.json, the backend wins.

export type Role = "admin" | "lecturer"; // dashboard roles
export type Method = "fingerprint" | "face" | "manual"; // how attendance was recorded
export type RosterStatus = "present" | "absent" | "revoked"; // roster line state

export interface UserOut { id: number; email: string; full_name: string; role: Role; is_active: boolean; created_at: string; } // account
export interface TokenOut { access_token: string; token_type: "bearer"; expires_in: number; user: UserOut; } // login response
export interface Page<T> { items: T[]; total: number; } // paginated list

export interface CourseOut { id: number; code: string; name: string; is_active: boolean; lecturer_count: number; student_count: number; } // course
export interface DeviceSummary { id: number; name: string; online: boolean; busy: boolean; } // terminal picker row

export interface SessionCreate { course_id: number; device_id: number; venue: string; } // open-session body
export interface SessionCounts { roster: number; present: number; absent: number; } // headline numbers
export interface SessionOut { // session header
  id: number; course_id: number; course_code: string; course_name: string; venue: string; // what + where
  device_id: number; device_name: string; lecturer_id: number; lecturer_name: string; // terminal + who opened it
  opened_at: string; closed_at: string | null; is_open: boolean; counts: SessionCounts; // when + totals
}
export interface RosterEntry { // one student in one session
  student_id: number; student_number: string; full_name: string; status: RosterStatus; // who + state
  attendance_id: number | null; method: Method | null; recorded_at: string | null; device_time: string | null; // the record
  fp_confidence: number | null; note: string | null; revoked_at: string | null; revoke_reason: string | null; // details
  recorded_by_name: string | null; // lecturer who entered it
}
export interface RosterView { session: SessionOut; entries: RosterEntry[]; } // live roster response
export interface ManualMark { student_number: string; reason: string; } // manual mark body (reason 3–255)
export interface RevokeIn { reason: string; } // revoke body (reason 3–255)
export interface ReportRow { student_id: number; student_number: string; full_name: string; attended: number; percentage: number; } // report line
export interface CourseReport { course: CourseOut; closed_sessions: number; students: ReportRow[]; } // report
export interface ChangePasswordIn { current_password: string; new_password: string; } // new password ≥ 8

// ---- Admin (Phase 2) — copied from Backend/app/schemas/admin.py ----

export type CommandType = "enrol" | "delete_slot"; // what a terminal is asked to do
export type CommandStatus = "pending" | "in_progress" | "done" | "failed" | "cancelled" | "expired"; // command life cycle

export interface UserCreate { email: string; full_name: string; role: Role; password: string; } // POST /admin/users
export interface UserUpdate { full_name?: string; role?: Role; is_active?: boolean; } // PATCH /admin/users/{id}
export interface PasswordResetIn { new_password: string; } // POST /admin/users/{id}/reset-password

export interface StudentCreate { student_number: string; full_name: string; } // POST /admin/students
export interface StudentUpdate { full_name?: string; is_active?: boolean; } // PATCH /admin/students/{id}
export interface ConsentUpdate { consent: boolean; } // PUT /admin/students/{id}/consent
export interface EnrolIn { device_id: number; } // POST /admin/students/{id}/enrol
export interface StudentOut { // a student in lists
  id: number; student_number: string; full_name: string; is_active: boolean; // identity
  biometric_consent: boolean; consent_at: string | null; enrolled_device_ids: number[]; // POPIA + enrolment
}
export interface CourseBrief { id: number; code: string; name: string; } // course reference in a student detail
export interface SlotOut { device_id: number; device_name: string; slot_number: number; } // one fingerprint slot
export interface CommandOut { // a queued terminal command
  id: number; device_id: number; type: CommandType; status: CommandStatus; slot_number: number; // what + where
  student_id: number | null; student_number: string | null; // who
  created_at: string; expires_at: string | null; completed_at: string | null; result_detail: string | null; // when + outcome
}
export interface StudentDetail extends StudentOut { courses: CourseBrief[]; fingerprint_slots: SlotOut[]; open_commands: CommandOut[]; } // GET /admin/students/{id}

export interface CourseCreate { code: string; name: string; } // POST /admin/courses
export interface CourseUpdate { name?: string; is_active?: boolean; } // PATCH /admin/courses/{id}
export interface LecturersSet { user_ids: number[]; } // replaces the whole set
export interface StudentsAdd { student_numbers: string[]; } // 1–500 numbers
export interface RosterChange { added: string[]; already_present: string[]; unknown: string[]; } // roster add result
export interface RosterImportOut extends RosterChange { created: string[]; } // CSV import result
export interface CourseDetail extends CourseOut { lecturers: UserOut[]; students: StudentOut[]; } // GET /admin/courses/{id}

export interface DeviceCreate { name: string; } // POST /admin/devices
export interface DeviceUpdate { is_active?: boolean; } // PATCH /admin/devices/{id}
export interface DeviceOut { // a terminal (never the secret)
  id: number; name: string; is_active: boolean; last_seen_at: string | null; online: boolean; // identity + liveness
  open_session_id: number | null; enrolled_count: number; pending_commands: number; // workload
}
export interface DeviceCreated extends DeviceOut { hmac_secret: string; } // create/rotate: the only place the secret appears

export interface AuditOut { // one audit row
  id: number; created_at: string; actor_user_id: number | null; actor_name: string | null; // when + who
  action: string; entity: string; entity_id: string; details: Record<string, unknown>; // what
}
