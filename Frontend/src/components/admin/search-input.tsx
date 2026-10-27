"use client"; // typing state + URL updates

import { useEffect, useState } from "react"; // React
import { Search } from "lucide-react"; // icon
import { Input } from "@/components/ui/input"; // the box
import { useDebounced } from "@/hooks/use-debounced"; // 300 ms settle
import { useQueryState } from "@/hooks/use-query-state"; // ?q=

export function SearchInput({ label, placeholder }: { label: string; placeholder: string }) { // debounced search that writes ?q= and resets offset (admin spec §3.1)
  const { get, set } = useQueryState(); // URL state
  const [text, setText] = useState(() => get("q") ?? ""); // starts from the URL (refresh keeps it)
  const settled = useDebounced(text.trim(), 300); // wait 300 ms after typing stops

  useEffect(() => { // push the settled value into the URL
    if ((get("q") ?? "") !== settled) set({ q: settled }); // only when it changed (also resets offset)
  }, [settled, get, set]); // after each settle

  return (
    // icon inside the field, visible label for screen readers
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <label htmlFor="list-search" className="sr-only">{label}</label>
      <Input id="list-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className="h-10 pl-9" autoComplete="off" />
    </div>
  );
}
