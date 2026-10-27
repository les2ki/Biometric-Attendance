import { ChevronLeft, ChevronRight } from "lucide-react"; // arrows
import { Button } from "@/components/ui/button"; // prev/next

interface PaginationBarProps { total: number; limit: number; offset: number; onChange: (offset: number) => void; } // paging state (admin spec §3.1)

export function PaginationBar({ offset, limit, total, onChange }: PaginationBarProps) { // "Showing 1–20 of 57" + Previous / Next
  const from = total === 0 ? 0 : offset + 1; // first row number
  const to = Math.min(offset + limit, total); // last row number
  return (
    // count on the left, buttons on the right
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p className="tabular" aria-live="polite">Showing {from}–{to} of {total}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          <ChevronLeft className="size-4" aria-hidden />Previous
        </Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          Next<ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
