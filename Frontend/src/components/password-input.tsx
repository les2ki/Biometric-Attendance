"use client"; // toggles visibility in the browser

import { forwardRef, useState, type ComponentProps } from "react"; // React
import { Eye, EyeOff } from "lucide-react"; // show/hide icons
import { Input } from "@/components/ui/input"; // base input
import { cn } from "@/lib/utils"; // class merging

export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(function PasswordInput({ className, ...props }, ref) { // password field with a show/hide button
  const [visible, setVisible] = useState(false); // plain text or dots?
  return (
    // input with a reserved right-edge slot for the toggle (no layout shift)
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      {/* toggle button: 40px square hit target inside the field */}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground outline-none hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});
