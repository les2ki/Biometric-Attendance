"use client"; // uses auth state + menu interactions

import Link from "next/link"; // client navigation
import { LogOut, UserRound } from "lucide-react"; // icons
import { Avatar, AvatarFallback } from "@/components/ui/avatar"; // initials circle
import { Button } from "@/components/ui/button"; // trigger
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"; // menu parts
import { RoleBadge } from "@/components/role-badge"; // admin / lecturer tag
import { useAuth } from "@/lib/auth"; // current user + logout
import { initials } from "@/lib/format"; // "Lee Lecturer" → "LL"

export function UserMenu() { // avatar button → profile + Account + Log out
  const { user, logout } = useAuth(); // who is logged in
  if (!user) return null; // RequireAuth normally prevents this

  return (
    <DropdownMenu>
      {/* avatar trigger */}
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu for ${user.full_name}`}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-paper-3 font-mono text-xs text-ink">{initials(user.full_name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      {/* menu */}
      <DropdownMenuContent align="end" className="w-60">
        {/* who */}
        <DropdownMenuLabel className="space-y-1 font-normal">
          <p className="truncate text-sm font-medium text-ink">{user.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <RoleBadge role={user.role} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* account page */}
        <DropdownMenuItem asChild>
          <Link href="/account"><UserRound className="size-4" aria-hidden />Account</Link>
        </DropdownMenuItem>
        {/* sign out */}
        <DropdownMenuItem onSelect={() => logout("manual")}>
          <LogOut className="size-4" aria-hidden />Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
