import type { ReactNode } from "react"; // children types
import { Label } from "@/components/ui/label"; // accessible label
import { cn } from "@/lib/utils"; // class merging

interface FormFieldProps { // label + control + helper/error
  id: string; // links label, control and messages
  label: string; // visible label (never placeholder-as-label)
  error?: string; // replaces the helper text when set
  helper?: ReactNode; // hint under the field
  children: ReactNode; // the input itself
  className?: string; // layout overrides
}

export function FormField({ id, label, error, helper, children, className }: FormFieldProps) { // Hallmark form rules: label above, message below, stable height
  return (
    // label → control → message, 6px rhythm
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium text-ink">{label}</Label>
      {children}
      {/* message slot keeps one line of height so errors don't push the page */}
      <p id={`${id}-message`} role={error ? "alert" : undefined} className={cn("min-h-[1lh] text-xs", error ? "text-danger" : "text-muted-foreground")}>
        {error ?? helper}
      </p>
    </div>
  );
}
