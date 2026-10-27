import { LoaderCircle } from "lucide-react"; // spinner icon

export function FullScreenLoader({ label = "Loading" }: { label?: string }) { // shown while the session is restored
  return (
    // centred spinner; role=status so screen readers announce it
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center bg-paper">
      {/* spinner + text label (never colour or motion alone) */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        <span>{label}…</span>
      </div>
    </div>
  );
}
