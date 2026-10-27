export interface SessionFilter { courseId?: number; openOnly?: boolean; offset?: number; limit?: number; } // list filters

export const qk = { // every query key in one place
  me: ["auth", "me"] as const, // current user
  lecturerCourses: ["lecturer", "courses"] as const, // courses I teach
  lecturerDevices: ["lecturer", "devices"] as const, // terminals for the picker
  sessionsAll: ["lecturer", "sessions"] as const, // prefix: invalidates every session list
  sessions: (f: SessionFilter) => ["lecturer", "sessions", f] as const, // session lists
  session: (id: number) => ["lecturer", "session", id] as const, // one session header
  attendance: (id: number) => ["lecturer", "attendance", id] as const, // live roster
  report: (courseId: number) => ["lecturer", "report", courseId] as const, // course report

  // ---- admin (WP8) ----
  admin: ["admin"] as const, // prefix: everything admin
  adminUsers: (f: object) => ["admin", "users", f] as const, // staff accounts
  adminUsersAll: ["admin", "users"] as const, // prefix for user lists
  adminStudents: (f: object) => ["admin", "students", f] as const, // student lists
  adminStudentsAll: ["admin", "students"] as const, // prefix for student lists
  adminStudent: (id: number) => ["admin", "student", id] as const, // student detail
  adminCourses: (f: object) => ["admin", "courses", f] as const, // course lists
  adminCoursesAll: ["admin", "courses"] as const, // prefix for course lists
  adminCourse: (id: number) => ["admin", "course", id] as const, // course detail
  adminDevices: ["admin", "devices"] as const, // terminals
  adminDeviceCommands: (id: number, f: object) => ["admin", "device-commands", id, f] as const, // command history
  adminDeviceCommandsAll: ["admin", "device-commands"] as const, // prefix for command histories
  adminAudit: (f: object) => ["admin", "audit", f] as const, // audit log
};
