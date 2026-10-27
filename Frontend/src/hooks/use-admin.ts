"use client"; // TanStack Query hooks run in the browser

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query"; // data fetching
import { toast } from "sonner"; // feedback
import { apiFetch, apiUpload, qs } from "@/lib/api"; // HTTP layer
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly error text
import { qk } from "@/lib/query-keys"; // cache keys
import type { // API shapes
  AuditOut, CommandOut, CommandStatus, ConsentUpdate, CourseCreate, CourseDetail, CourseOut, CourseUpdate, DeviceCreate, DeviceCreated, // (types only — erased at build time)
  DeviceOut, DeviceUpdate, EnrolIn, LecturersSet, Page, PasswordResetIn, RosterChange, RosterImportOut, Role, StudentCreate, // admin request/response types
  StudentDetail, StudentOut, StudentUpdate, StudentsAdd, UserCreate, UserOut, UserUpdate, // ditto
} from "@/lib/types";

export const ADMIN_PAGE_SIZE = 50; // admin spec §3.2: default limit

// ---------- queries ----------

export interface UserFilter { role?: Role; search?: string; offset?: number; limit?: number; } // /admin/users filters
export function useAdminUsers(f: UserFilter) { // GET /admin/users
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminUsers(f), // per filter
    queryFn: ({ signal }) => apiFetch<Page<UserOut>>(`/admin/users${qs({ role: f.role, search: f.search, limit: f.limit ?? ADMIN_PAGE_SIZE, offset: f.offset ?? 0 })}`, { token, signal }), // request
    enabled: !!token, // wait for login
    placeholderData: keepPreviousData, // smooth paging
  });
}

export interface StudentFilter { search?: string; courseId?: number; active?: boolean; offset?: number; limit?: number; } // /admin/students filters
export function useAdminStudents(f: StudentFilter) { // GET /admin/students (alphabetical)
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminStudents(f), // per filter
    queryFn: ({ signal }) => apiFetch<Page<StudentOut>>(`/admin/students${qs({ search: f.search, course_id: f.courseId, active: f.active, limit: f.limit ?? ADMIN_PAGE_SIZE, offset: f.offset ?? 0 })}`, { token, signal }), // request
    enabled: !!token, // wait for login
    placeholderData: keepPreviousData, // smooth paging
  });
}

export function useAdminStudent(id: number) { // GET /admin/students/{id}
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminStudent(id), // cache key
    queryFn: ({ signal }) => apiFetch<StudentDetail>(`/admin/students/${id}`, { token, signal }), // request
    enabled: !!token && Number.isInteger(id), // valid id only
    refetchInterval: (query) => ((query.state.data?.open_commands.length ?? 0) > 0 ? 2000 : false), // spec §5.2: poll every 2 s while a command is open
  });
}

export function useAdminCourses(active?: boolean) { // GET /admin/courses
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminCourses({ active }), // per filter
    queryFn: ({ signal }) => apiFetch<CourseOut[]>(`/admin/courses${qs({ active })}`, { token, signal }), // request
    enabled: !!token, // wait for login
  });
}

export function useAdminCourse(id: number) { // GET /admin/courses/{id}
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminCourse(id), // cache key
    queryFn: ({ signal }) => apiFetch<CourseDetail>(`/admin/courses/${id}`, { token, signal }), // request
    enabled: !!token && Number.isInteger(id), // valid id only
  });
}

export function useAdminDevices(refetchMs: number | false = 10_000) { // GET /admin/devices
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminDevices, // cache key
    queryFn: ({ signal }) => apiFetch<DeviceOut[]>("/admin/devices", { token, signal }), // request
    enabled: !!token, // wait for login
    refetchInterval: refetchMs, // online dots stay current (spec §7.1: 10 s; overview: 15 s)
  });
}

export interface CommandFilter { status?: CommandStatus; offset?: number; limit?: number; } // command history filters
export function useDeviceCommands(deviceId: number | null, f: CommandFilter = {}, pollMs: number | false | ((open: boolean) => number | false) = false) { // GET /admin/devices/{id}/commands (newest first)
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminDeviceCommands(deviceId ?? 0, f), // per device + filter
    queryFn: ({ signal }) => apiFetch<Page<CommandOut>>(`/admin/devices/${deviceId}/commands${qs({ status: f.status, limit: f.limit ?? 20, offset: f.offset ?? 0 })}`, { token, signal }), // request
    enabled: !!token && deviceId !== null, // only when a device is chosen
    refetchInterval: (query) => { // fixed interval, or depending on whether anything is still open
      if (typeof pollMs !== "function") return pollMs; // fixed
      const open = (query.state.data?.items ?? []).some((c) => c.status === "pending" || c.status === "in_progress"); // anything still running?
      return pollMs(open); // caller decides
    },
  });
}

export function useAllDeviceCommands(devices: DeviceOut[] | undefined) { // last 20 commands of every terminal (overview "Needs attention")
  const token = useToken(); // auth
  return useQueries({ // one query per terminal
    queries: (devices ?? []).map((d) => ({ // each terminal
      queryKey: qk.adminDeviceCommands(d.id, { limit: 20 }), // shared with the history view
      queryFn: ({ signal }: { signal: AbortSignal }) => apiFetch<Page<CommandOut>>(`/admin/devices/${d.id}/commands${qs({ limit: 20 })}`, { token, signal }), // request
      enabled: !!token, // wait for login
    })),
  });
}

export interface AuditFilter { action?: string; entity?: string; actorUserId?: number; since?: string; until?: string; offset?: number; limit?: number; } // /admin/audit filters
export function useAdminAudit(f: AuditFilter) { // GET /admin/audit (newest first)
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminAudit(f), // per filter
    queryFn: ({ signal }) => apiFetch<Page<AuditOut>>(`/admin/audit${qs({ action: f.action, entity: f.entity, actor_user_id: f.actorUserId, since: f.since, until: f.until, limit: f.limit ?? ADMIN_PAGE_SIZE, offset: f.offset ?? 0 })}`, { token, signal }), // request
    enabled: !!token, // wait for login
    placeholderData: keepPreviousData, // smooth paging
  });
}

// ---------- mutations ----------

interface MutationOptions<TVars, TResult> { // shared behaviour for admin writes
  invalidate: (vars: TVars, result: TResult) => QueryKey[]; // cache keys to refresh (admin spec §3.7)
  success?: (result: TResult, vars: TVars) => string | undefined; // toast text; undefined = silent success (the change is visible)
  toastErrors?: boolean; // default true; false when the page shows the error inline instead
  sensitive?: boolean; // true when the result holds a secret: drop it from the mutation cache straight away
}

function useAdminMutation<TVars, TResult>(fn: (vars: TVars, token: string | null) => Promise<TResult>, options: MutationOptions<TVars, TResult>) { // useMutation + refresh + toasts
  const token = useToken(); // auth
  const queryClient = useQueryClient(); // cache
  return useMutation({ // write
    mutationFn: (vars: TVars) => fn(vars, token), // request
    ...(options.sensitive ? { gcTime: 0 } : {}), // secrets: no lingering copy once the caller resets
    onSuccess: (result, vars) => { // done
      for (const key of options.invalidate(vars, result)) queryClient.invalidateQueries({ queryKey: key }); // refresh what changed
      const message = options.success?.(result, vars); // optional toast
      if (message) toast.success(message); // only when the effect isn't already visible
    },
    onError: (err) => { if (options.toastErrors !== false) toast.error(errorMessage(err)); }, // friendly message
  });
}

const studentKeys = (id?: number): QueryKey[] => [qk.adminStudentsAll, ...(id ? [qk.adminStudent(id)] : []), qk.adminDevices]; // spec §3.7 student rule
const commandKeys: QueryKey[] = [qk.adminDeviceCommandsAll]; // + command histories
const courseKeys = (id?: number): QueryKey[] => [qk.adminCoursesAll, ...(id ? [qk.adminCourse(id)] : []), qk.lecturerCourses]; // spec §3.7 course rule
const deviceKeys: QueryKey[] = [qk.adminDevices, qk.adminDeviceCommandsAll, qk.lecturerDevices]; // spec §3.7 device rule

// staff accounts
export const useCreateUser = () => useAdminMutation((body: UserCreate, token) => apiFetch<UserOut>("/admin/users", { method: "POST", body, token }), { invalidate: () => [qk.adminUsersAll], success: (u) => `Account created for ${u.full_name}`, toastErrors: false }); // POST (email_taken shown inline)
export const useUpdateUser = () => useAdminMutation(({ id, body }: { id: number; body: UserUpdate }, token) => apiFetch<UserOut>(`/admin/users/${id}`, { method: "PATCH", body, token }), { invalidate: () => [qk.adminUsersAll] }); // PATCH (row updates in place)
export const useResetPassword = () => useAdminMutation(({ id, body }: { id: number; body: PasswordResetIn }, token) => apiFetch<void>(`/admin/users/${id}/reset-password`, { method: "POST", body, token }), { invalidate: () => [qk.adminUsersAll], success: () => "Password reset" }); // POST (spec §8.1)

// students
export const useCreateStudent = () => useAdminMutation((body: StudentCreate, token) => apiFetch<StudentOut>("/admin/students", { method: "POST", body, token }), { invalidate: () => studentKeys(), success: () => "Student added", toastErrors: false }); // POST (student_number_taken inline)
export const useUpdateStudent = (id: number) => useAdminMutation((body: StudentUpdate, token) => apiFetch<StudentOut>(`/admin/students/${id}`, { method: "PATCH", body, token }), { invalidate: () => [...studentKeys(id), ...commandKeys, ...courseKeys()] }); // PATCH (deactivating queues wipes)
export const useSetConsent = (id: number) => useAdminMutation((consent: boolean, token) => apiFetch<StudentOut>(`/admin/students/${id}/consent`, { method: "PUT", body: { consent } satisfies ConsentUpdate, token }), { invalidate: () => [...studentKeys(id), ...commandKeys, ...courseKeys()] }); // PUT consent (badge + Card 3 show the result)
export const useEnrolStudent = (id: number) => useAdminMutation((deviceId: number, token) => apiFetch<CommandOut>(`/admin/students/${id}/enrol`, { method: "POST", body: { device_id: deviceId } satisfies EnrolIn, token }), { invalidate: () => [...studentKeys(id), ...commandKeys], toastErrors: false }); // POST enrol (errors inline in the dialog)
export const useDeleteFingerprints = (id: number) => useAdminMutation((deviceId: number | null, token) => apiFetch<CommandOut[]>(`/admin/students/${id}/fingerprints${qs({ device_id: deviceId })}`, { method: "DELETE", token }), { // DELETE fingerprints
  invalidate: () => [...studentKeys(id), ...commandKeys, ...courseKeys()], // refresh
  success: (wipes) => (wipes.length === 1 ? `Fingerprint deleted. The terminal will wipe slot ${wipes[0].slot_number} next time it checks in.` : wipes.length > 1 ? "Fingerprints deleted. Each terminal will wipe its slot next time it checks in." : "No fingerprints were stored."), // spec §5.2
});

// courses
export const useCreateCourse = () => useAdminMutation((body: CourseCreate, token) => apiFetch<CourseOut>("/admin/courses", { method: "POST", body, token }), { invalidate: () => courseKeys(), toastErrors: false }); // POST (navigates to the new course; course_code_taken inline)
export const useUpdateCourse = (id: number) => useAdminMutation((body: CourseUpdate, token) => apiFetch<CourseOut>(`/admin/courses/${id}`, { method: "PATCH", body, token }), { invalidate: () => courseKeys(id) }); // PATCH (header updates in place)
export const useSetLecturers = (id: number) => useAdminMutation((userIds: number[], token) => apiFetch<CourseDetail>(`/admin/courses/${id}/lecturers`, { method: "PUT", body: { user_ids: userIds } satisfies LecturersSet, token }), { invalidate: () => courseKeys(id), toastErrors: false }); // PUT lecturers (not_a_lecturer inline)
export const useAddStudents = (id: number) => useAdminMutation((numbers: string[], token) => apiFetch<RosterChange>(`/admin/courses/${id}/students`, { method: "POST", body: { student_numbers: numbers } satisfies StudentsAdd, token }), { invalidate: () => [...courseKeys(id), qk.adminStudentsAll] }); // POST roster (result panel)
export const useRemoveStudent = (courseId: number) => useAdminMutation((studentId: number, token) => apiFetch<void>(`/admin/courses/${courseId}/students/${studentId}`, { method: "DELETE", token }), { invalidate: () => [...courseKeys(courseId), qk.adminStudentsAll] }); // DELETE roster row (row disappears)
export const useImportRoster = (id: number) => useAdminMutation((file: File, token) => apiUpload<RosterImportOut>(`/admin/courses/${id}/students/import`, file, token), { invalidate: () => [...courseKeys(id), qk.adminStudentsAll], toastErrors: false }); // multipart CSV (bad_csv inline)

// terminals
export const useCreateDevice = () => useAdminMutation((name: string, token) => apiFetch<DeviceCreated>("/admin/devices", { method: "POST", body: { name } satisfies DeviceCreate, token }), { invalidate: () => deviceKeys, toastErrors: false, sensitive: true }); // POST (secret dialog follows; device_name_taken inline)
export const useUpdateDevice = () => useAdminMutation(({ id, isActive }: { id: number; isActive: boolean }, token) => apiFetch<DeviceOut>(`/admin/devices/${id}`, { method: "PATCH", body: { is_active: isActive } satisfies DeviceUpdate, token }), { invalidate: () => deviceKeys }); // PATCH (status updates in place)
export const useRotateSecret = () => useAdminMutation((id: number, token) => apiFetch<DeviceCreated>(`/admin/devices/${id}/rotate-secret`, { method: "POST", token }), { invalidate: () => deviceKeys, sensitive: true }); // POST (secret dialog follows)
export const useCancelCommand = () => useAdminMutation((id: number, token) => apiFetch<CommandOut>(`/admin/commands/${id}/cancel`, { method: "POST", token }), { invalidate: () => [...deviceKeys, qk.adminStudentsAll, ["admin", "student"]] }); // POST cancel (badge flips to Cancelled)
