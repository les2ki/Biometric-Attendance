import type { AuditOut } from "@/lib/types"; // audit row

const LABELS: Record<string, string> = { // action code → human label (admin spec §8.2)
  "attendance.manual": "Marked present manually", // lecturer fallback
  "attendance.revoked": "Revoked attendance", // soft delete
  "attendance.reinstated": "Reinstated attendance", // undo revoke
  "attendance.exported": "Exported attendance CSV", // download
  "fingerprint.enrol_requested": "Requested fingerprint enrolment", // admin queued an enrol
  "fingerprint.enrolled": "Fingerprint enrolled", // terminal confirmed
  "fingerprint.deleted": "Deleted fingerprints", // POPIA deletion
  "fingerprint.slot_wiped": "Terminal wiped a slot", // terminal confirmed the wipe
  "consent.granted": "Recorded consent", // POPIA
  "consent.withdrawn": "Withdrew consent", // POPIA
  "session.opened": "Opened a session", // lecturer
  "session.closed": "Closed a session", // lecturer
  "course.created": "Created a course", // admin
  "course.updated": "Updated a course", // rename / archive
  "course.lecturers_set": "Changed course lecturers", // assignment
  "course.students_added": "Added students to a class list", // roster
  "course.student_removed": "Removed a student from a class list", // roster
  "course.students_imported": "Imported a class list (CSV)", // roster
  "student.created": "Added a student", // admin
  "student.updated": "Updated a student", // rename / deactivate
  "device.created": "Added a terminal", // admin
  "device.updated": "Changed a terminal’s status", // activate / deactivate
  "device.secret_rotated": "Rotated a terminal secret", // admin
  "device.command_cancelled": "Cancelled a terminal command", // admin
  "device.command_failed": "Terminal reported a failure", // terminal
  "user.created": "Created a staff account", // admin
  "user.updated": "Updated a staff account", // role / active
  "user.password_reset": "Reset a password", // admin
  "auth.password_changed": "Changed their own password", // any user
};

export function actionLabel(action: string): string { // human label, or the raw code when unknown
  return LABELS[action] ?? action; // fallback = raw code
}

export function targetHref(a: Pick<AuditOut, "entity" | "entity_id">): string | null { // link the target when it has a page
  if (a.entity === "students") return `/admin/students/${a.entity_id}`; // student detail
  if (a.entity === "courses") return `/admin/courses/${a.entity_id}`; // course detail
  if (a.entity === "sessions") return `/lecturer/sessions/${a.entity_id}`; // live/closed session page
  return null; // no page for this entity
}
