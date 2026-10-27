import Link from "next/link"; // navigation
import { Button } from "@/components/ui/button"; // link button

export default function NotFound() { // 404 for unknown URLs
  return (
    // left-aligned message, not a centred hero
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold">This page doesn’t exist.</h1>
      <p className="text-ink-2">The link may be old, or the session or course was removed.</p>
      <div><Button asChild><Link href="/">Back to the dashboard</Link></Button></div>
    </main>
  );
}
