"use client"; // form + dialog state

import { useEffect, useMemo } from "react"; // React
import { Controller, useForm, useWatch } from "react-hook-form"; // form state (Controller wraps the Select components)
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { LoaderCircle, TriangleAlert } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // venue
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // pickers
import { DeviceBadge, deviceState } from "@/components/device-badge"; // Online / Offline / In use
import { FormField } from "@/components/form-field"; // label + message
import { useLecturerCourses, useLecturerDevices, useOpenSession } from "@/hooks/use-lecturer"; // data
import { ApiError } from "@/lib/api"; // error type
import { errorMessage } from "@/lib/errors"; // friendly text

const VENUE_KEY = "ba.lastVenue"; // sessionStorage key for "remember the last venue" (spec §6.3)

const schema = z.object({ // valid form
  course_id: z.string().min(1, "Choose a course."), // Select values are strings
  device_id: z.string().min(1, "Choose a terminal."), // ditto
  venue: z.string().trim().min(1, "Enter the venue, e.g. Building 10, Room 112.").max(50, "Keep the venue to 50 characters or fewer."), // 1–50 chars (backend rule)
});
type OpenSessionValues = z.infer<typeof schema>; // form values

function readLastVenue(): string { // last venue typed in this tab
  try { // storage may be blocked
    return window.sessionStorage.getItem(VENUE_KEY) ?? ""; // saved value or empty
  } catch { // privacy mode
    return ""; // start empty
  }
}

interface OpenSessionDialogProps { open: boolean; onOpenChange: (open: boolean) => void; defaultCourseId?: number; } // controlled dialog

export function OpenSessionDialog({ open, onOpenChange, defaultCourseId }: OpenSessionDialogProps) { // "Open session" modal (spec §6.3)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* content only mounts while open, so the form starts fresh every time */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Open session</DialogTitle>
          <DialogDescription>The terminal picks up the new session within about 30 seconds.</DialogDescription>
        </DialogHeader>
        {open && <OpenSessionForm onDone={() => onOpenChange(false)} defaultCourseId={defaultCourseId} />}
      </DialogContent>
    </Dialog>
  );
}

function OpenSessionForm({ onDone, defaultCourseId }: { onDone: () => void; defaultCourseId?: number }) { // the form inside the dialog
  const courses = useLecturerCourses(); // my courses
  const devices = useLecturerDevices(true); // terminals (refetched every 10 s while open)
  const openSession = useOpenSession(); // POST mutation
  const activeCourses = useMemo(() => (courses.data ?? []).filter((c) => c.is_active), [courses.data]); // archived courses can't be used
  const { control, register, handleSubmit, formState, setValue, getValues, setError } = useForm<OpenSessionValues>({ // form state
    resolver: zodResolver(schema), // validation
    mode: "onTouched", // validate after the first blur
    defaultValues: { course_id: defaultCourseId ? String(defaultCourseId) : "", device_id: "", venue: readLastVenue() }, // remembered venue
  });

  useEffect(() => { // only one course? pick it for the lecturer
    if (!getValues("course_id") && activeCourses.length === 1) setValue("course_id", String(activeCourses[0].id), { shouldValidate: true }); // preselect
  }, [activeCourses, getValues, setValue]); // when courses load

  const deviceId = useWatch({ control, name: "device_id" }); // re-render when the terminal choice changes
  const selectedDevice = (devices.data ?? []).find((d) => String(d.id) === deviceId); // currently chosen terminal
  const noCourses = courses.isSuccess && activeCourses.length === 0; // not assigned to anything

  const onSubmit = handleSubmit((values) => { // schema passed
    try { window.sessionStorage.setItem(VENUE_KEY, values.venue.trim()); } catch { /* storage blocked: skip the convenience */ } // remember venue
    openSession.mutate( // POST /lecturer/sessions
      { course_id: Number(values.course_id), device_id: Number(values.device_id), venue: values.venue.trim() }, // body
      {
        onSuccess: () => onDone(), // close; the hook navigates to the live page
        onError: (err) => { // also show problems next to the right field
          if (!(err instanceof ApiError)) return; // unknown error: the toast is enough
          if (err.code === "validation_error" && err.fieldErrors) { // 422 from FastAPI
            for (const [field, message] of Object.entries(err.fieldErrors)) { // each bad field
              if (field === "course_id" || field === "device_id" || field === "venue") setError(field, { message }); // map onto the form
            }
          }
          if (err.code.startsWith("course_")) setError("course_id", { message: errorMessage(err) }); // course problems
          if (err.code.startsWith("device_")) setError("device_id", { message: errorMessage(err) }); // terminal problems
        },
      },
    );
  });

  return (
    // the form
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      {/* course picker */}
      <FormField id="course" label="Course" error={formState.errors.course_id?.message ?? (noCourses ? "You’re not assigned to any course yet. Ask an administrator." : undefined)}>
        <Controller
          control={control}
          name="course_id"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled={noCourses}>
              <SelectTrigger id="course" className="h-11 w-full" aria-invalid={!!formState.errors.course_id} aria-describedby="course-message" onBlur={field.onBlur}>
                <SelectValue placeholder={courses.isPending ? "Loading courses…" : "Choose a course"} />
              </SelectTrigger>
              <SelectContent>
                {activeCourses.map((c) => ( // each course
                  <SelectItem key={c.id} value={String(c.id)}>
                    <span className="font-medium">{c.code}</span> — {c.name} <span className="text-muted-foreground">({c.student_count} students)</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      {/* terminal picker */}
      <FormField
        id="device"
        label="Terminal"
        error={formState.errors.device_id?.message}
        helper={selectedDevice && !selectedDevice.online && !selectedDevice.busy ? (
          // offline warning (still allowed)
          <span className="flex items-start gap-1.5 text-revoked"><TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />This terminal hasn’t checked in recently. Make sure it’s switched on and connected to Wi-Fi.</span>
        ) : undefined}
      >
        <Controller
          control={control}
          name="device_id"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="device" className="h-11 w-full" aria-invalid={!!formState.errors.device_id} aria-describedby="device-message" onBlur={field.onBlur}>
                <SelectValue placeholder={devices.isPending ? "Loading terminals…" : "Choose a terminal"} />
              </SelectTrigger>
              <SelectContent>
                {(devices.data ?? []).map((d) => ( // each terminal; busy ones can't be chosen
                  <SelectItem key={d.id} value={String(d.id)} disabled={d.busy}>
                    <span className="font-medium">{d.name}</span>
                    <DeviceBadge state={deviceState(d)} className="ml-2" />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      {/* venue */}
      <FormField id="venue" label="Venue" error={formState.errors.venue?.message}>
        <Input id="venue" placeholder="Building 10, Room 112" maxLength={50} autoComplete="off" className="h-11" aria-invalid={!!formState.errors.venue} aria-describedby="venue-message" {...register("venue")} />
      </FormField>

      {/* actions */}
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="lg" disabled={openSession.isPending || noCourses}>
          {openSession.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {openSession.isPending ? "Starting…" : "Start session"}
        </Button>
      </DialogFooter>
    </form>
  );
}
