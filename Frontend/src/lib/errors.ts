import { ApiError } from "@/lib/api"; // the error class apiFetch throws

const MESSAGES: Record<string, string> = { // backend error code → sentence a person can act on
  network_error: "Can’t reach the server. Is the backend running on port 8000?", // backend down
  invalid_credentials: "Email or password is incorrect.", // login
  token_expired: "Your session has ended. Please log in again.", // 30-min token ran out
  invalid_token: "Your session has ended. Please log in again.", // garbled token
  inactive_user: "Your session has ended. Please log in again.", // account disabled
  forbidden: "You don’t have permission to do that.", // wrong role
  course_not_found: "Course not found, or you’re not assigned to it.", // D5: 404 for other lecturers' courses
  course_inactive: "This course is archived.", // can't open sessions
  device_not_found: "Terminal not found.", // bad device ID
  device_inactive: "This terminal is disabled.", // revoked terminal
  device_busy: "That terminal already has an open session. Close it first or pick another terminal.", // one session per device
  session_not_found: "Session not found.", // bad ID or not theirs
  session_already_closed: "This session is already closed.", // double close
  unknown_student: "No student with that number.", // manual mark
  not_in_course: "That student isn’t on this course’s class list.", // D2 roster rule
  student_inactive: "That student is deactivated.", // inactive student
  already_present: "That student is already marked present.", // duplicate manual mark
  attendance_not_found: "Attendance record not found.", // bad attendance ID
  already_revoked: "That record was already revoked.", // double revoke
  wrong_current_password: "Your current password is incorrect.", // change password
  validation_error: "Please check the highlighted fields.", // 422
  // ---- admin (admin-dashboard-spec §3.8) ----
  email_taken: "An account with that email already exists.", // create user
  user_not_found: "Account not found.", // bad user ID
  cannot_modify_self: "You can’t change your own role or deactivate yourself.", // self-lockout guard
  last_admin: "There must always be at least one active administrator.", // last-admin guard
  student_number_taken: "A student with that number already exists.", // create student
  student_not_found: "Student not found.", // bad student ID
  no_consent: "Record biometric consent before enrolling a fingerprint.", // POPIA
  already_enrolled: "This student’s fingerprint is already on that terminal.", // duplicate enrolment
  enrolment_pending: "An enrolment for this student is already waiting on that terminal.", // queued twice
  sensor_full: "That terminal’s fingerprint sensor is full.", // no free slot
  device_name_taken: "A terminal with that name already exists.", // create device
  course_code_taken: "A course with that code already exists.", // create course
  not_a_lecturer: "Only active lecturer accounts can be assigned to a course.", // lecturer assignment
  not_on_roster: "That student isn’t on this course’s class list.", // remove from roster
  bad_csv: "The CSV file has a problem on row {row}. Expected columns: student_number,full_name.", // import ({row} filled in below)
  unknown_command: "Command not found.", // cancel command
  command_not_active: "That command has already finished.", // cancel finished command
  wipe_cannot_be_cancelled: "Fingerprint deletions can’t be cancelled (POPIA).", // wipe guard
};

export function errorMessage(err: unknown): string { // friendly sentence for any thrown error
  if (err instanceof ApiError) { // our own error type
    const known = MESSAGES[err.code]; // look up the code
    if (known && known.includes("{row}")) return known.replace("{row}", String(err.extra?.row ?? err.row ?? "?")); // fill in the CSV row
    if (known) return known; // mapped message
    return `Something went wrong (${err.code}).`; // unmapped code: still show it for support
  }
  return "Something went wrong. Please try again."; // non-API error (bug)
}

export function errorCode(err: unknown): string | null { // the backend code, for inline field errors
  return err instanceof ApiError ? err.code : null; // null for non-API errors
}
