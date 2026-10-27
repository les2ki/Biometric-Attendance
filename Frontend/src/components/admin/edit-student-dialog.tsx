"use client"; // form + dialog state

import { useForm } from "react-hook-form"; // form state
import { zodResolver } from "@hookform/resolvers/zod"; // zod bridge
import { z } from "zod"; // validation
import { LoaderCircle } from "lucide-react"; // spinner
import { Button } from "@/components/ui/button"; // actions
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // name
import { FormField } from "@/components/form-field"; // label + message
import { useUpdateStudent } from "@/hooks/use-admin"; // PATCH /admin/students/{id}
import type { StudentOut } from "@/lib/types"; // student shape

const schema = z.object({ full_name: z.string().trim().min(1, "Enter the full name.").max(120, "Keep the name to 120 characters or fewer.") }); // 1–120
type EditValues = z.infer<typeof schema>; // form values

export function EditStudentDialog({ student, open, onOpenChange }: { student: StudentOut; open: boolean; onOpenChange: (open: boolean) => void }) { // "Edit name" (admin spec §5.2, P2)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Edit name</DialogTitle>
          <DialogDescription>Student number {student.student_number} can’t be changed.</DialogDescription>
        </DialogHeader>
        {open && <EditForm student={student} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ student, onDone }: { student: StudentOut; onDone: () => void }) { // the form
  const update = useUpdateStudent(student.id); // mutation
  const { register, handleSubmit, formState } = useForm<EditValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { full_name: student.full_name } }); // form state
  const onSubmit = handleSubmit((values) => update.mutate({ full_name: values.full_name.trim() }, { onSuccess: () => onDone() })); // PATCH, then close

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <FormField id="edit-name" label="Full name" error={formState.errors.full_name?.message}>
        <Input id="edit-name" className="h-11" aria-invalid={!!formState.errors.full_name} aria-describedby="edit-name-message" {...register("full_name")} />
      </FormField>
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          Save name
        </Button>
      </DialogFooter>
    </form>
  );
}
