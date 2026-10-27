"use client"; // dialog + form state

import { useMemo, useState } from "react"; // React
import { Download, FileUp, LoaderCircle, Search } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // actions
import { Checkbox } from "@/components/ui/checkbox"; // lecturer picker
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"; // modal
import { Input } from "@/components/ui/input"; // fields
import { Label } from "@/components/ui/label"; // labels
import { Textarea } from "@/components/ui/textarea"; // student numbers
import { FormField } from "@/components/form-field"; // label + message
import { useAddStudents, useAdminUsers, useImportRoster, useSetLecturers, useUpdateCourse } from "@/hooks/use-admin"; // data
import { ApiError, saveBlob } from "@/lib/api"; // error type + client-side download
import { errorMessage } from "@/lib/errors"; // friendly text
import type { CourseDetail, RosterChange, RosterImportOut } from "@/lib/types"; // shapes
import { cn } from "@/lib/utils"; // class merging

interface DialogBase { course: CourseDetail; open: boolean; onOpenChange: (open: boolean) => void; } // shared props

export function RenameCourseDialog({ course, open, onOpenChange }: DialogBase) { // "Rename" (admin spec §6.2, P2)
  const update = useUpdateCourse(course.id); // PATCH
  const [name, setName] = useState(course.name); // field value
  const error = name.trim().length === 0 ? "Enter the course name." : name.trim().length > 120 ? "Keep the name to 120 characters or fewer." : null; // 1–120

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setName(course.name); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Rename {course.code}</DialogTitle>
          <DialogDescription>The course code can’t be changed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!error) update.mutate({ name: name.trim() }, { onSuccess: () => onOpenChange(false) }); }} noValidate className="space-y-2">
          <FormField id="rename-course" label="Course name" error={error ?? undefined}>
            <Input id="rename-course" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-11" aria-invalid={!!error} aria-describedby="rename-course-message" />
          </FormField>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!!error || update.isPending}>{update.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Save name</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditLecturersDialog({ course, open, onOpenChange }: DialogBase) { // "Edit lecturers" (admin spec §6.2)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Lecturers for {course.code}</DialogTitle>
          <DialogDescription>Lecturers only see courses they’re assigned to.</DialogDescription>
        </DialogHeader>
        {open && <LecturerPicker course={course} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LecturerPicker({ course, onDone }: { course: CourseDetail; onDone: () => void }) { // searchable checkbox list
  const lecturers = useAdminUsers({ role: "lecturer", limit: 200 }); // every lecturer account
  const save = useSetLecturers(course.id); // PUT (replaces the set)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(course.lecturers.map((u) => u.id))); // current assignment
  const [filter, setFilter] = useState(""); // search text
  const [error, setError] = useState<string | null>(null); // inline error (not_a_lecturer)
  const current = useMemo(() => new Set(course.lecturers.map((u) => u.id)), [course.lecturers]); // assigned now
  const needle = filter.trim().toLowerCase(); // case-insensitive search
  const choices = (lecturers.data?.items ?? []) // active lecturers, plus inactive ones already assigned (shown disabled)
    .filter((u) => u.is_active || current.has(u.id)) // spec: inactive excluded unless current
    .filter((u) => !needle || u.full_name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)); // search

  const toggle = (id: number, on: boolean) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; }); // tick / untick

  const submit = () => { // PUT the full set
    setError(null); // clear
    save.mutate([...selected], { onSuccess: () => onDone(), onError: (err) => setError(err instanceof ApiError ? errorMessage(err) : "Something went wrong.") }); // inline errors
  };

  return (
    <div className="space-y-3">
      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="lecturer-filter" className="sr-only">Search lecturers</label>
        <Input id="lecturer-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name or email" className="h-10 pl-9" autoComplete="off" />
      </div>
      {/* list */}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {lecturers.isPending && <li className="text-sm text-muted-foreground">Loading…</li>}
        {lecturers.data && choices.length === 0 && <li className="text-sm text-muted-foreground">No lecturer accounts match. Create one under Staff accounts.</li>}
        {choices.map((u) => ( // one checkbox per lecturer
          <li key={u.id}>
            <Label htmlFor={`lect-${u.id}`} className={cn("flex items-center gap-3 rounded-md px-2 py-2 font-normal", u.is_active ? "cursor-pointer hover:bg-paper-2" : "cursor-not-allowed opacity-60")}>
              <Checkbox id={`lect-${u.id}`} checked={selected.has(u.id)} disabled={!u.is_active} onCheckedChange={(v) => toggle(u.id, v === true)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{u.full_name}{!u.is_active && <span className="ml-2 text-xs text-revoked">Inactive</span>}</span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
              </span>
            </Label>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={submit} disabled={save.isPending}>{save.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Save lecturers</Button>
      </DialogFooter>
    </div>
  );
}

export function parseStudentNumbers(text: string): { numbers: string[]; invalid: string[] } { // "one per line or comma-separated" → deduped list
  const tokens = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean); // split on whitespace / commas / semicolons
  const unique = [...new Set(tokens)]; // dedupe
  return { numbers: unique.filter((t) => /^[0-9]{6,12}$/.test(t)), invalid: unique.filter((t) => !/^[0-9]{6,12}$/.test(t)) }; // digits-only check (client side)
}

export function AddStudentsDialog({ course, open, onOpenChange, onResult }: DialogBase & { onResult: (r: RosterChange) => void }) { // "Add students" (admin spec §6.2)
  const add = useAddStudents(course.id); // POST /students
  const [text, setText] = useState(""); // textarea
  const { numbers, invalid } = parseStudentNumbers(text); // parsed input
  const tooMany = numbers.length > 500; // backend limit

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setText(""); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Add students to {course.code}</DialogTitle>
          <DialogDescription>Students must already be registered. Unknown numbers are listed afterwards.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="add-numbers">One student number per line, or separated by commas</Label>
          <Textarea id="add-numbers" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"220000001\n220000002"} className="min-h-32 resize-y font-mono text-sm" aria-describedby="add-numbers-help" />
          <p id="add-numbers-help" className={cn("min-h-[1lh] text-xs", invalid.length || tooMany ? "text-danger" : "text-muted-foreground")}>
            {invalid.length > 0 ? `Not 6–12 digits: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}` : tooMany ? "At most 500 numbers at a time." : `${numbers.length} ${numbers.length === 1 ? "number" : "numbers"}`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={numbers.length === 0 || invalid.length > 0 || tooMany || add.isPending} onClick={() => add.mutate(numbers, { onSuccess: (r) => { onResult(r); setText(""); onOpenChange(false); } })}>
            {add.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Add to class list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportCsvDialog({ course, open, onOpenChange, onResult }: DialogBase & { onResult: (r: RosterImportOut) => void }) { // "Import CSV" (admin spec §6.3)
  const importer = useImportRoster(course.id); // multipart upload
  const [file, setFile] = useState<File | null>(null); // chosen file
  const error = importer.error; // last failure

  const downloadTemplate = () => saveBlob(new Blob(["student_number,full_name\n220000004,Example Name\n"], { type: "text/csv;charset=utf-8" }), "class-list-template.csv"); // generated client-side

  const close = (o: boolean) => { if (!o) { setFile(null); importer.reset(); } onOpenChange(o); }; // reset on close

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Import a class list into {course.code}</DialogTitle>
          <DialogDescription>Missing students are created without consent. If any row is invalid, nothing is imported.</DialogDescription>
        </DialogHeader>
        {/* expected format */}
        <div className="space-y-2">
          <p className="text-sm text-ink-2">Expected format (first row is the header):</p>
          <pre className="rounded-md border border-rule bg-paper-2 px-3 py-2 font-mono text-xs text-ink">student_number,full_name{"\n"}220000004,Example Name</pre>
          <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 rounded text-sm text-cobalt hover:underline focus-visible:outline-2 focus-visible:outline-ring"><Download className="size-3.5" aria-hidden />Download template</button>
        </div>
        {/* file picker (the label is the styled surface) */}
        <Label htmlFor="roster-csv" className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-rule-2/70 px-3 py-4 text-sm font-medium text-ink-2 hover:border-cobalt/60 hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
          <FileUp className="size-4" aria-hidden />{file ? file.name : "Choose a .csv file"}
          <input id="roster-csv" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); importer.reset(); }} />
        </Label>
        {/* all-or-nothing error */}
        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
            {errorMessage(error)}{error instanceof ApiError && error.code === "bad_csv" ? ` Nothing was imported. Fix row ${error.extra?.row ?? error.row ?? "?"} and try again.` : ""}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button disabled={!file || importer.isPending} onClick={() => file && importer.mutate(file, { onSuccess: (r) => { onResult(r); close(false); } })}>
            {importer.isPending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
