"use client"; // sorting state + row clicks

import { useMemo, useState, type ReactNode } from "react"; // React
import { ArrowDownUp, ChevronRight } from "lucide-react"; // icons
import { Skeleton } from "@/components/ui/skeleton"; // loading rows
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"; // shadcn table
import { cn } from "@/lib/utils"; // class merging

export interface Column<T> { // one column (admin spec §3.1)
  key: string; // unique id
  header: ReactNode; // heading text
  cell: (row: T) => ReactNode; // how to draw the cell
  className?: string; // e.g. "text-right"
  sortable?: (row: T) => string | number; // value to sort by (makes the header clickable)
}

interface DataTableProps<T> { // the generic table
  caption: string; // screen-reader caption
  columns: Column<T>[]; // what to show
  rows: T[] | undefined; // data (undefined while loading)
  rowKey: (row: T) => string | number; // React key
  loading?: boolean; // show skeleton rows
  empty?: ReactNode; // shown when rows is []
  onRowClick?: (row: T) => void; // whole-row click (adds a chevron)
  rowLabel?: (row: T) => string; // accessible name for the row's open button
  minWidth?: string; // table min width before it scrolls sideways
}

export function DataTable<T>({ caption, columns, rows, rowKey, loading, empty, onRowClick, rowLabel, minWidth = "44rem" }: DataTableProps<T>) { // generic admin table
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null); // active sort

  const sorted = useMemo(() => { // apply the sort (client-side, current page only)
    if (!rows || !sort) return rows; // unsorted
    const col = columns.find((c) => c.key === sort.key); // the sorted column
    if (!col?.sortable) return rows; // not sortable
    const value = col.sortable; // getter
    return [...rows].sort((a, b) => (value(a) < value(b) ? -sort.dir : value(a) > value(b) ? sort.dir : 0)); // stable copy
  }, [rows, sort, columns]); // recompute when inputs change

  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 })); // asc → desc → asc

  if (rows && rows.length === 0 && empty) return <>{empty}</>; // nothing to show
  const colCount = columns.length + (onRowClick ? 1 : 0); // for full-width cells

  return (
    // horizontal scroll inside the border on phones; the page never scrolls sideways
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
      <Table style={{ minWidth }}>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => ( // each heading
              <TableHead key={c.key} className={c.className}>
                {c.sortable ? (
                  <button type="button" onClick={() => toggle(c.key)} aria-pressed={sort?.key === c.key} className="-mx-1 inline-flex items-center gap-1 rounded px-1 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">
                    {c.header}<ArrowDownUp className={cn("size-3.5", sort?.key === c.key ? "text-cobalt" : "text-muted-foreground")} aria-hidden />
                  </button>
                ) : c.header}
              </TableHead>
            ))}
            {onRowClick && <TableHead className="w-10"><span className="sr-only">Open</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* loading skeleton */}
          {loading && !rows && Array.from({ length: 6 }, (_, i) => <TableRow key={`sk-${i}`}><TableCell colSpan={colCount}><Skeleton className="h-5 w-full" /></TableCell></TableRow>)}
          {/* rows */}
          {sorted?.map((row) => ( // each row
            <TableRow key={rowKey(row)} className={onRowClick ? "cursor-pointer" : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.cell(row)}</TableCell>)}
              {onRowClick && (
                <TableCell>
                  {/* keyboard-reachable open button (the row click is a mouse convenience) */}
                  <button type="button" onClick={(e) => { e.stopPropagation(); onRowClick(row); }} aria-label={rowLabel ? rowLabel(row) : "Open"} className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
