"use client"; // TanStack Query hooks run in the browser

import { useEffect, useState } from "react"; // object-URL lifecycle
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"; // data fetching
import { toast } from "sonner"; // feedback
import { apiFetch, fetchBlob } from "@/lib/api"; // HTTP layer
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly error text
import { qk } from "@/lib/query-keys"; // cache keys
import type { CommandOut, FaceCommandOut, FaceDeviceIn, FaceStatus, FaceVerifyIn } from "@/lib/types"; // API shapes

const FINAL = new Set(["done", "failed", "expired", "cancelled"]); // statuses that end a face job
export const isFinal = (status: string | undefined) => !!status && FINAL.has(status); // helper for components

export function useFaceStatus(studentId: number) { // GET /admin/students/{id}/face
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.adminFace(studentId), // per student
    queryFn: ({ signal }) => apiFetch<FaceStatus>(`/admin/students/${studentId}/face`, { token, signal }), // request
    enabled: !!token && Number.isInteger(studentId), // valid id only
  });
}

export function useFaceCommand(id: number | null) { // GET /face/commands/{id}, polled every 1.5 s until it finishes
  const token = useToken(); // auth
  return useQuery({ // cached read
    queryKey: qk.faceCommand(id ?? 0), // per job
    queryFn: ({ signal }) => apiFetch<FaceCommandOut>(`/face/commands/${id}`, { token, signal }), // request
    enabled: !!token && id !== null, // only while tracking a job
    refetchInterval: (query) => (isFinal(query.state.data?.status) ? false : 1500), // stop once finished
  });
}

export function useFacePreview(id: number | null, available: boolean, version: number) { // the last picture as an object URL (memory only on the server)
  const token = useToken(); // auth
  const [url, setUrl] = useState<string | null>(null); // object URL for <img>
  useEffect(() => { // fetch whenever a new picture arrives (version = frames_received)
    if (id === null || !available || !token) return; // nothing to show yet
    const controller = new AbortController(); // cancel on change
    fetchBlob(`/face/commands/${id}/preview`, token, controller.signal) // GET PNG
      .then((blob) => { const next = URL.createObjectURL(blob); setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return next; }); }) // swap pictures without a blank frame
      .catch(() => { /* expired or aborted: keep whatever is shown */ }); // silent
    return () => controller.abort(); // stop a stale request
  }, [id, available, version, token]); // refetch per new frame
  useEffect(() => () => setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }), [id]); // new job or unmount → free the old picture
  return url; // null until loaded
}

function useFaceMutation<TVars>(fn: (vars: TVars, token: string | null) => Promise<CommandOut>, invalidateStudent?: number) { // queue a face job; errors are shown inline by the dialog
  const token = useToken(); // auth
  const queryClient = useQueryClient(); // cache
  return useMutation({ // write
    mutationFn: (vars: TVars) => fn(vars, token), // request
    onSuccess: () => { // queued
      if (invalidateStudent) queryClient.invalidateQueries({ queryKey: qk.adminStudent(invalidateStudent) }); // Card 3 shows the open job
      queryClient.invalidateQueries({ queryKey: qk.adminDeviceCommandsAll }); // terminal histories
    },
  });
}

export const useEnrolFace = (studentId: number) => useFaceMutation((deviceId: number, token) => apiFetch<CommandOut>(`/admin/students/${studentId}/face/enrol`, { method: "POST", body: { device_id: deviceId } satisfies FaceDeviceIn, token }), studentId); // admin: 3 pictures
export const useCheckFace = (studentId: number) => useFaceMutation((deviceId: number, token) => apiFetch<CommandOut>(`/admin/students/${studentId}/face/check`, { method: "POST", body: { device_id: deviceId } satisfies FaceDeviceIn, token }), studentId); // admin: test match, no attendance
export const useSessionFaceVerify = (sessionId: number) => useFaceMutation((studentNumber: string, token) => apiFetch<CommandOut>(`/lecturer/sessions/${sessionId}/face-verify`, { method: "POST", body: { student_number: studentNumber } satisfies FaceVerifyIn, token })); // lecturer: at the session's terminal

export function useDeleteFace(studentId: number) { // DELETE /admin/students/{id}/face
  const token = useToken(); // auth
  const queryClient = useQueryClient(); // cache
  return useMutation({ // write
    mutationFn: () => apiFetch<void>(`/admin/students/${studentId}/face`, { method: "DELETE", token }), // request
    onSuccess: () => { // deleted
      queryClient.invalidateQueries({ queryKey: qk.adminFace(studentId) }); // card
      queryClient.invalidateQueries({ queryKey: qk.adminStudentsAll }); // Face column
      toast.success("Face data deleted"); // feedback
    },
    onError: (err) => toast.error(errorMessage(err)), // friendly message
  });
}
