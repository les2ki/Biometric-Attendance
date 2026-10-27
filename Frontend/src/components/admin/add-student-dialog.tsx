"use client"; // form + dialog state

import { useRouter } from "next/navigation"; // go to the new student
import { Controller, useForm, useWatch } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { LoaderCircle } from "lucide-react"; // spinner
import { useQueryClient } from "@tanstack/react-query"; // refresh after adding to a course
import { Button } from "@/components/ui/button"; // actions
import { Checkbox } from "@/components/ui/checkbox"; // "Add to course"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // fields
import { Label } from "@/components/ui/label"; // checkbox label
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // course picker
import { FormField } from "@/components/form-field"; // label + message
import { useAdminCourses, useCreateStudent } from "@/hooks/use-admin"; // data
import { apiFetch, ApiError } from "@/lib/api"; // roster call + error type
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly text
import { qk } from "@/lib/query-keys"; // cache keys
import type { RosterChange } from "@/lib/types"; // roster response

const schema = z.object({ // admin spec §5.1
  student_number: z.string().trim().regex(/^[0-9]{6,12}$/, "Student numbers are 6–12 digits."), // digits only
  full_name: z.string().trim().min(1, "Enter the student’s full name.").max(120, "Keep the name to 120 characters or fewer."), // display name
  add_to_course: z.boolean(), // optional roster step
  course_id: z.string(), // chosen course (string for the Select)
}).refine((v) => !v.add_to_course || v.course_id !== "", { path: ["course_id"], message: "Choose a course, or untick “Add to course”." }); // course needed when ticked
type StudentValues = z.infer<typeof schema>; // form values

export function AddStudentDialog({ open, onOpenChange, defaultCourseId }: { open: boolean; onOpenChange: (open: boolean) => void; defaultCourseId?: number }) { // "Add student"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Add student</DialogTitle>
          <DialogDescription>New students start without biometric consent. Record consent on their page before enrolling a finger.</DialogDescription>
        </DialogHeader>
        {open && <AddStudentForm onDone={() => onOpenChange(false)} defaultCourseId={defaultCourseId} />}
      </DialogContent>
    </Dialog>
  );
}

function AddStudentForm({ onDone, defaultCourseId }: { onDone: () => void; defaultCourseId?: number }) { // the form
  const router = useRouter(); // navigation
  const token = useToken(); // auth for the roster call
  const queryClient = useQueryClient(); // cache refresh
  const courses = useAdminCourses(true); // active courses for the picker
  const create = useCreateStudent(); // POST /admin/students
  const { register, handleSubmit, formState, setError, control } = useForm<StudentValues>({ // form state
    resolver: zodResolver(schema), // validation
    mode: "onTouched", // validate after first blur
    defaultValues: { student_number: "", full_name: "", add_to_course: !!defaultCourseId, course_id: defaultCourseId ? String(defaultCourseId) : "" }, // prefill when opened from a course
  });
  const addToCourse = useWatch({ control, name: "add_to_course" }); // show the course picker?

  const onSubmit = handleSubmit(async (values) => { // schema passed
    try { // create, then (optionally) add to the course
      const student = await create.mutateAsync({ student_number: values.student_number.trim(), full_name: values.full_name.trim() }); // POST (toast "Student added")
      if (values.add_to_course && values.course_id) { // roster step
        await apiFetch<RosterChange>(`/admin/courses/${values.course_id}/students`, { method: "POST", body: { student_numbers: [student.student_number] }, token }); // add to the class list
        queryClient.invalidateQueries({ queryKey: qk.adminCoursesAll }); // counts change
        queryClient.invalidateQueries({ queryKey: qk.adminCourse(Number(values.course_id)) }); // course detail
        queryClient.invalidateQueries({ queryKey: qk.lecturerCourses }); // lecturer side
      }
      onDone(); // close
      router.push(`/admin/students/${student.id}`); // consent + enrolment are the next steps (spec §5.1)
    } catch (err) { // inline errors
      if (err instanceof ApiError && err.code === "student_number_taken") setError("student_number", { message: errorMessage(err) }); // duplicate number
      else if (err instanceof ApiError && err.fieldErrors) for (const [f, m] of Object.entries(err.fieldErrors)) { if (f === "student_number" || f === "full_name") setError(f, { message: m }); } // 422
      else setError("root", { message: errorMessage(err) }); // anything else
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <FormField id="new-student-number" label="Student number" error={formState.errors.student_number?.message} helper="6–12 digits">
        <Input id="new-student-number" inputMode="numeric" autoComplete="off" className="tabular h-11 font-mono" aria-invalid={!!formState.errors.student_number} aria-describedby="new-student-number-message" {...register("student_number")} />
      </FormField>
      <FormField id="new-student-name" label="Full name" error={formState.errors.full_name?.message}>
        <Input id="new-student-name" autoComplete="off" className="h-11" aria-invalid={!!formState.errors.full_name} aria-describedby="new-student-name-message" {...register("full_name")} />
      </FormField>
      {/* optional: put them straight on a class list */}
      <Controller control={control} name="add_to_course" render={({ field }) => (
        <Label htmlFor="add-to-course" className="flex cursor-pointer items-center gap-2 py-1 text-sm font-normal">
          <Checkbox id="add-to-course" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />Add to course
        </Label>
      )} />
      {addToCourse && (
        <FormField id="new-student-course" label="Course" error={formState.errors.course_id?.message}>
          <Controller control={control} name="course_id" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="new-student-course" className="h-11 w-full" aria-invalid={!!formState.errors.course_id}><SelectValue placeholder="Choose a course" /></SelectTrigger>
              <SelectContent>{(courses.data ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </FormField>
      )}
      {formState.errors.root && <p role="alert" className="text-sm text-danger">{formState.errors.root.message}</p>}
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          Add student
        </Button>
      </DialogFooter>
    </form>
  );
}
