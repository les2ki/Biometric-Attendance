"use client"; // decides where to go using the browser session

import { useEffect } from "react"; // run the redirect after render
import { useRouter } from "next/navigation"; // client redirect
import { FullScreenLoader } from "@/components/full-screen-loader"; // shown for a split second
import { homeFor, useAuth } from "@/lib/auth"; // session + role routing

export default function Home() { // "/" has no content of its own (spec §5.4)
  const { ready, token, user, expiredOnRestore } = useAuth(); // session state
  const router = useRouter(); // redirect helper

  useEffect(() => { // pick the destination once the session is known
    if (!ready) return; // still reading sessionStorage
    if (!token || !user) router.replace(expiredOnRestore ? "/login?expired=1" : "/login"); // logged out (expired → banner)
    else router.replace(homeFor(user.role)); // admin → /admin, lecturer → /lecturer
  }, [ready, token, user, expiredOnRestore, router]); // re-run when the session changes

  return <FullScreenLoader label="Opening" />; // placeholder while redirecting
}
