"use client"; // needs the current path

import Link from "next/link"; // client navigation
import { usePathname } from "next/navigation"; // which page is open
import { BarChart3, BookOpen, CalendarCheck, Cpu, LayoutDashboard, ScrollText, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react"; // nav icons
import { useAuth } from "@/lib/auth"; // role decides the admin section
import { cn } from "@/lib/utils"; // class merging

interface NavItem { href: string; label: string; icon: LucideIcon; exact?: boolean; } // one link

const TEACHING: NavItem[] = [ // lecturers (spec §6.1)
  { href: "/lecturer", label: "Sessions", icon: CalendarCheck }, // overview + live sessions
  { href: "/lecturer/courses", label: "Courses", icon: BookOpen }, // courses + reports
  { href: "/account", label: "Account", icon: UserRound }, // profile + password
];

const ADMINISTRATION: NavItem[] = [ // admins only (admin spec §2.5)
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true }, // admin home
  { href: "/admin/students", label: "Students", icon: Users }, // consent + enrolment
  { href: "/admin/courses", label: "Courses", icon: BookOpen }, // rosters + lecturers
  { href: "/admin/devices", label: "Terminals", icon: Cpu }, // devices + secrets
  { href: "/admin/users", label: "Staff accounts", icon: ShieldCheck }, // staff accounts
  { href: "/admin/audit", label: "Audit log", icon: ScrollText }, // read-only history
];

const ADMIN_TEACHING: NavItem[] = [ // the lecturer pages, across all courses, for admins
  { href: "/lecturer", label: "Sessions", icon: CalendarCheck }, // every session
  { href: "/lecturer/courses", label: "Reports", icon: BarChart3 }, // attendance reports
];

const ACCOUNT: NavItem[] = [{ href: "/account", label: "Account", icon: UserRound }]; // bottom link for admins

function isActive(pathname: string, item: NavItem): boolean { // highlight rule
  if (item.href === "/lecturer") return pathname === "/lecturer" || pathname.startsWith("/lecturer/sessions"); // live pages belong to Sessions
  if (item.exact) return pathname === item.href; // overview pages match exactly
  return pathname === item.href || pathname.startsWith(item.href + "/"); // section + its children
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) { // the rail's link list
  const pathname = usePathname(); // current URL path
  const { hasRole } = useAuth(); // role check

  const renderGroup = (title: string | null, items: NavItem[]) => ( // one labelled group of links
    <div className="space-y-1">
      {/* group label (only for the admin section) */}
      {title && <p className="px-3 pb-1 font-mono text-[0.65rem] font-medium tracking-[0.1em] text-graphite-muted uppercase">{title}</p>}
      {/* links */}
      <ul className="space-y-0.5">
        {items.map((item) => { // each link
          const active = isActive(pathname, item); // is this the open page?
          const Icon = item.icon; // icon component
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm whitespace-nowrap outline-none transition-colors duration-(--dur-micro) ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-bright",
                  active ? "bg-graphite-2 font-medium text-graphite-ink" : "text-graphite-muted hover:bg-graphite-2/60 hover:text-graphite-ink",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-cobalt-bright" : "text-graphite-muted")} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    // lecturers: one list; admins: Administration, Teaching, then Account (admin spec A3)
    <nav aria-label="Main" className="space-y-6">
      {hasRole("admin") ? (
        <>
          {renderGroup("Administration", ADMINISTRATION)}
          {renderGroup("Teaching", ADMIN_TEACHING)}
          {renderGroup(null, ACCOUNT)}
        </>
      ) : renderGroup(null, TEACHING)}
    </nav>
  );
}
