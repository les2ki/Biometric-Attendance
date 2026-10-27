"use client"; // reads/writes the theme in the browser

import { Laptop, Moon, Sun } from "lucide-react"; // icons
import { useTheme } from "next-themes"; // theme state
import { Button } from "@/components/ui/button"; // trigger button
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"; // menu parts

export function ThemeToggle() { // Light / Dark / System picker
  const { theme, setTheme } = useTheme(); // current choice + setter

  return (
    <DropdownMenu>
      {/* icon-only trigger: sun in light mode, moon in dark mode (pure CSS, no flicker) */}
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change colour theme">
          <Sun className="size-4 dark:hidden" aria-hidden />
          <Moon className="hidden size-4 dark:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* the three choices */}
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><Sun className="size-4" aria-hidden />Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="size-4" aria-hidden />Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Laptop className="size-4" aria-hidden />System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
