"use client"; // download happens in the browser

import { useState } from "react"; // pending flag
import { Download, LoaderCircle } from "lucide-react"; // icons
import { toast } from "sonner"; // feedback
import { Button } from "@/components/ui/button"; // the button
import { downloadFile } from "@/lib/api"; // authenticated download
import { useToken } from "@/lib/auth"; // bearer token
import { errorMessage } from "@/lib/errors"; // friendly text

export function ExportButton({ sessionId }: { sessionId: number }) { // "Export CSV" (spec §6.4)
  const token = useToken(); // auth
  const [pending, setPending] = useState(false); // spinner while downloading

  const onClick = async () => { // download the CSV
    if (!token) return; // RequireAuth guarantees a token; just in case
    setPending(true); // show the spinner
    try { // the request can fail
      const filename = await downloadFile(`/lecturer/sessions/${sessionId}/export.csv`, token); // backend also writes an attendance.exported audit row
      toast.success(`Exported ${filename}`); // the download itself is easy to miss, so confirm it
    } catch (err) { // failed
      toast.error(errorMessage(err)); // friendly message
    } finally { // always
      setPending(false); // hide the spinner
    }
  };

  return (
    // outline button: secondary to "Mark present"
    <Button variant="outline" size="lg" onClick={onClick} disabled={pending}>
      {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="size-4" aria-hidden />}
      Export CSV
    </Button>
  );
}
