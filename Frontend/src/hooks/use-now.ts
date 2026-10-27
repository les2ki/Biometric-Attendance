"use client"; // timers only run in the browser

import { useEffect, useState } from "react"; // React state + effects

export function useNow(intervalMs: number): number { // current time (ms), re-rendering every intervalMs
  const [now, setNow] = useState(() => Date.now()); // start with "now"
  useEffect(() => { // start the ticker
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs); // tick
    return () => window.clearInterval(timer); // stop on unmount
  }, [intervalMs]); // restart if the interval changes
  return now; // ms timestamp
}
