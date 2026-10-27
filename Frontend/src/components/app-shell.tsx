"use client"; // menu state, clock and auth live in the browser

import { useState, type ReactNode } from "react"; // React
import Link from "next/link"; // client navigation
import { Menu } from "lucide-react"; // hamburger icon
import { Button } from "@/components/ui/button"; // icon buttons
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"; // mobile slide-over
import { NavLinks } from "@/components/nav-links"; // the link list
import { RoleBadge } from "@/components/role-badge"; // admin / lecturer tag
import { ThemeToggle } from "@/components/theme-toggle"; // light/dark
import { UserMenu } from "@/components/user-menu"; // avatar menu
import { useNow } from "@/hooks/use-now"; // ticking clock
import { useAuth } from "@/lib/auth"; // current user
import { fmtClock } from "@/lib/format"; // HH:mm in SAST

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Biometric Attendance"; // product name

function Wordmark({ onNavigate }: { onNavigate?: () => void }) { // name + small cobalt square (the visual anchor)
  return (
    // links home; the square is the only colour in the rail header
    <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md px-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-bright">
      <span className="size-2.5 rounded-[2px] bg-cobalt-bright" aria-hidden />
      <span className="font-display text-[0.95rem] font-semibold tracking-tight whitespace-nowrap text-graphite-ink">{APP_NAME}</span>
    </Link>
  );
}

function RailContents({ onNavigate }: { onNavigate?: () => void }) { // shared by the desktop rail and the mobile sheet
  const { user } = useAuth(); // for the user card
  return (
    // three stacked zones: name, links, user card
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      {/* top: product name */}
      <div className="px-2"><Wordmark onNavigate={onNavigate} /></div>
      {/* middle: navigation (scrolls if the screen is short) */}
      <div className="min-h-0 flex-1 overflow-y-auto"><NavLinks onNavigate={onNavigate} /></div>
      {/* bottom: who is signed in */}
      {user && (
        <div className="space-y-1 border-t border-graphite-rule px-3 pt-4">
          <p className="truncate text-sm font-medium text-graphite-ink">{user.full_name}</p>
          <div className="flex items-center gap-2">
            <RoleBadge role={user.role} className="border-graphite-rule text-graphite-muted" />
            <span className="truncate text-xs text-graphite-muted">{user.email}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) { // sidebar + top bar + content (spec §6.1)
  const { hasRole } = useAuth(); // admin pill
  const [menuOpen, setMenuOpen] = useState(false); // mobile sheet open?
  const now = useNow(15_000); // clock refresh every 15 s is plenty for HH:mm

  return (
    // two columns on desktop: fixed rail + flexible content
    <div className="min-h-dvh bg-paper md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* skip link for keyboard users */}
      <a href="#main" className="sr-only z-(--z-toast) rounded-md bg-surface px-3 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>

      {/* desktop rail: the page's one dark graphite band (Cobalt) */}
      <aside className="sticky top-0 hidden h-dvh border-r border-graphite-rule bg-graphite md:block">
        <RailContents />
      </aside>

      {/* right column: top bar + page */}
      <div className="flex min-w-0 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-(--z-sticky) flex h-14 items-center gap-2 border-b border-rule bg-paper/90 px-3 backdrop-blur-sm md:px-6">
          {/* mobile: hamburger + short name */}
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
            <Menu className="size-5" aria-hidden />
          </Button>
          <Link href="/" className="font-display text-sm font-semibold whitespace-nowrap text-ink md:hidden">{APP_NAME}</Link>
          {/* admins always see which mode they're in (admin spec §2.5) */}
          {hasRole("admin") && <span className="inline-flex h-5 items-center rounded border border-cobalt/40 px-1.5 font-mono text-[0.65rem] font-medium tracking-[0.08em] text-cobalt uppercase">Admin</span>}
          {/* right side: clock, theme, user */}
          <div className="ml-auto flex items-center gap-1">
            <time dateTime={new Date(now).toISOString()} className="tabular hidden px-2 font-mono text-sm text-muted-foreground sm:block" aria-label="Current time in Johannesburg">
              {fmtClock(new Date(now))} <span className="text-xs">SAST</span>
            </time>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* page content */}
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>

      {/* mobile navigation sheet (same contents as the rail) */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] border-graphite-rule bg-graphite p-0 text-graphite-ink">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Pages you can open</SheetDescription>
          <RailContents onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
