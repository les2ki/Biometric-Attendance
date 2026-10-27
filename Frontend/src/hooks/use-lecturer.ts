"use client"; // TanStack Query hooks run in the browser

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"; // data fetching
import { useRouter } from "next/navigation"; // navigate after opening a session
import { toast } from "sonner"; // feedback
import { apiFetch, qs } from "@/lib/api"; // HTTP layer
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly error text
import { qk } from "@/lib/query-keys"; // cache keys
import type { ChangePasswordIn, CourseOut, CourseReport, DeviceSummary, ManualMark, Page, RevokeIn, RosterEntry, RosterView, SessionCreate, SessionOut } from "@/lib/types"; // API shapes

export function useLecturerCourses() { // GET /lecturer/courses — courses I teach (admin: all active)
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.lecturerCourses, // cache key
    queryFn: ({ signal }) => apiFetch<CourseOut[]>("/lecturer/courses", { token, signal }), // request
    enabled: !!token, // wait for login
  });
}

export function useLecturerDevices(enabled: boolean) { // GET /lecturer/devices — terminal picker
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.lecturerDevices, // cache key
    queryFn: ({ signal }) => apiFetch<DeviceSummary[]>("/lecturer/devices", { token, signal }), // request
    enabled: !!token && enabled, // only while the dialog is open
    refetchInterval: enabled ? 10_000 : false, // keep online/busy fresh while picking
  });
}

export interface SessionListFilter { courseId?: number; openOnly?: boolean; offset?: number; limit?: number; } // list filters

export function useSessions({ courseId, openOnly, offset = 0, limit = 20 }: SessionListFilter) { // GET /lecturer/sessions — paged list
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.sessions({ courseId, openOnly, offset, limit }), // one cache entry per filter
    queryFn: ({ signal }) => apiFetch<Page<SessionOut>>(`/lecturer/sessions${qs({ limit, offset, course_id: courseId, open_only: openOnly })}`, { token, signal }), // request
    enabled: !!token, // wait for login
    placeholderData: keepPreviousData, // keep the old page visible while the next one loads
  });
}

export function useOpenSessions() { // sessions running right now (overview "Running now")
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.sessions({ openOnly: true, offset: 0, limit: 50 }), // separate cache entry
    queryFn: ({ signal }) => apiFetch<Page<SessionOut>>(`/lecturer/sessions${qs({ open_only: true, limit: 50, offset: 0 })}`, { token, signal }), // request
    enabled: !!token, // wait for login
    refetchInterval: 15_000, // counts on the cards stay roughly live
  });
}

export function useSession(id: number) { // GET /lecturer/sessions/{id} — one session header
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.session(id), // cache key
    queryFn: ({ signal }) => apiFetch<SessionOut>(`/lecturer/sessions/${id}`, { token, signal }), // request
    enabled: !!token && Number.isInteger(id), // valid id only
  });
}

export function useRoster(id: number, isOpen: boolean | undefined) { // GET /lecturer/sessions/{id}/attendance — live roster
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.attendance(id), // cache key
    queryFn: ({ signal }) => apiFetch<RosterView>(`/lecturer/sessions/${id}/attendance`, { token, signal }), // request
    enabled: !!token && Number.isInteger(id), // valid id only
    refetchInterval: (query) => { // poll every 3 s while open (U6); paused automatically when the tab is hidden
      const open = query.state.data ? query.state.data.session.is_open : isOpen; // the roster's own copy wins once loaded
      return open ? 3000 : false; // closed sessions stop polling
    },
    staleTime: 0, // always treat as stale so focus/visit refreshes immediately
  });
}

export function useOpenSession() { // POST /lecturer/sessions — start a session
  const token = useToken(); // auth
  const queryClient = useQueryClient(); // cache
  const router = useRouter(); // navigation
  return useMutation({ // write
    mutationFn: (body: SessionCreate) => apiFetch<SessionOut>("/lecturer/sessions", { method: "POST", body, token }), // request
    onSuccess: (session) => { // opened
      queryClient.invalidateQueries({ queryKey: qk.sessionsAll }); // lists change
      queryClient.invalidateQueries({ queryKey: qk.lecturerDevices }); // the terminal is now busy
      queryClient.setQueryData(qk.session(session.id), session); // pre-fill the live page header
      router.push(`/lecturer/sessions/${session.id}`); // go live
    },
    onError: (err) => { // failed
      toast.error(errorMessage(err)); // friendly message
      queryClient.invalidateQueries({ queryKey: qk.lecturerDevices }); // e.g. device_busy: refresh the picker
    },
  });
}

function useInvalidateSession(id: number) { // shared "this session changed" refresh
  const queryClient = useQueryClient(); // cache
  return () => { // call after a write
    queryClient.invalidateQueries({ queryKey: qk.attendance(id) }); // roster
    queryClient.invalidateQueries({ queryKey: qk.session(id) }); // header counts
    queryClient.invalidateQueries({ queryKey: qk.sessionsAll }); // lists show counts too
  };
}

export function useCloseSession(id: number) { // POST /lecturer/sessions/{id}/close
  const token = useToken(); // auth
  const invalidate = useInvalidateSession(id); // refresh helper
  const queryClient = useQueryClient(); // cache
  return useMutation({ // write
    mutationFn: () => apiFetch<SessionOut>(`/lecturer/sessions/${id}/close`, { method: "POST", token }), // request
    onSuccess: (session) => { // closed
      queryClient.setQueryData(qk.session(id), session); // header flips to "Closed" immediately
      invalidate(); // refresh the rest
      queryClient.invalidateQueries({ queryKey: qk.lecturerDevices }); // terminal is free again
      toast.success("Session closed"); // spec §6.4
    },
    onError: (err) => toast.error(errorMessage(err)), // friendly message
  });
}

export function useManualMark(sessionId: number) { // POST /lecturer/sessions/{id}/manual — mark present / reinstate
  const token = useToken(); // auth
  const invalidate = useInvalidateSession(sessionId); // refresh helper
  return useMutation({ // write
    mutationFn: (body: ManualMark) => apiFetch<RosterEntry>(`/lecturer/sessions/${sessionId}/manual`, { method: "POST", body, token }), // request
    onSuccess: (entry) => { // recorded
      invalidate(); // roster + counts
      toast.success(`${entry.full_name} marked present`); // spec §6.2
    },
    onError: (err) => toast.error(errorMessage(err)), // friendly message (the dialog also shows it inline)
  });
}

export function useRevoke(sessionId: number) { // POST /lecturer/attendance/{id}/revoke — soft delete
  const token = useToken(); // auth
  const invalidate = useInvalidateSession(sessionId); // refresh helper
  return useMutation({ // write
    mutationFn: ({ attendanceId, body }: { attendanceId: number; body: RevokeIn }) => apiFetch<RosterEntry>(`/lecturer/attendance/${attendanceId}/revoke`, { method: "POST", body, token }), // request
    onSuccess: () => { // revoked
      invalidate(); // roster + counts
      toast.success("Record revoked"); // spec §6.2
    },
    onError: (err) => toast.error(errorMessage(err)), // friendly message
  });
}

export function useCourseReport(courseId: number) { // GET /lecturer/courses/{id}/report (WP7)
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.report(courseId), // cache key
    queryFn: ({ signal }) => apiFetch<CourseReport>(`/lecturer/courses/${courseId}/report`, { token, signal }), // request
    enabled: !!token && Number.isInteger(courseId), // valid id only
  });
}

export function useChangePassword() { // POST /auth/change-password (WP7)
  const token = useToken(); // auth
  return useMutation({ // write
    mutationFn: (body: ChangePasswordIn) => apiFetch<void>("/auth/change-password", { method: "POST", body, token }), // 204 on success
    onSuccess: () => toast.success("Password changed"), // spec §7
    onError: (err) => toast.error(errorMessage(err)), // friendly message (inline too)
  });
}
