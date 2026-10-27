import type { ReactNode } from "react"; // children type
import { RequireAuth } from "@/components/require-auth"; // role guard

export default function AdminLayout({ children }: { children: ReactNode }) { // every /admin page (spec §8)
  return <RequireAuth roles={["admin"]}>{children}</RequireAuth>; // lecturers get a friendly "no access" message
}
