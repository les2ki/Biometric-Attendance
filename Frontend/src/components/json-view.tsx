"use client"; // open/closed state

import { useState } from "react"; // React
import { ChevronDown, ChevronRight } from "lucide-react"; // toggle icons

interface JsonViewProps { value: Record<string, unknown>; defaultOpen?: boolean; } // what to show

export function JsonView({ value, defaultOpen = false }: JsonViewProps) { // pretty-printed audit details, collapsible (admin spec §3.1)
  const [open, setOpen] = useState(defaultOpen); // expanded?
  const keys = Object.keys(value ?? {}); // top-level fields
  if (keys.length === 0) return <span className="text-xs text-muted-foreground">—</span>; // nothing recorded

  return (
    <div className="space-y-1.5">
      {/* toggle with a summary of the field names */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex max-w-full items-center gap-1 rounded text-left text-xs text-muted-foreground outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">
        {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
        <span className="truncate font-mono">{open ? "Hide details" : keys.join(", ")}</span>
      </button>
      {/* the JSON */}
      {open && <pre className="max-h-72 overflow-auto rounded-md border border-rule bg-paper-2 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-2">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}
