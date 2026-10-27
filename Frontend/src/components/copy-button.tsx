"use client"; // clipboard + timer

import { useEffect, useState } from "react"; // React
import { Check, Copy } from "lucide-react"; // icons
import { Button } from "@/components/ui/button"; // the button

interface CopyButtonProps { value: string; label: string; text?: string; } // what to copy + what it is called

export function CopyButton({ value, label, text = "Copy" }: CopyButtonProps) { // copies a value; the icon swap IS the feedback (no toast)
  const [copied, setCopied] = useState(false); // show the check briefly

  useEffect(() => { // revert after 2 s (admin spec §3.1)
    if (!copied) return; // nothing to undo
    const timer = window.setTimeout(() => setCopied(false), 2000); // 2 s
    return () => window.clearTimeout(timer); // cleanup
  }, [copied]); // when copied flips on

  const onClick = async () => { // copy to the clipboard
    try { // clipboard can be blocked
      await navigator.clipboard.writeText(value); // copy
      setCopied(true); // feedback
    } catch { // blocked (e.g. non-secure context)
      window.prompt(`Copy the ${label} manually:`, value); // fallback: let the user select it
    }
  };

  return (
    // outline button with a live label for screen readers
    <Button type="button" variant="outline" size="sm" onClick={onClick} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
      {copied ? <Check className="size-3.5 text-present" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : text}</span>
    </Button>
  );
}
