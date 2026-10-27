"use client"; // timers run in the browser

import { useEffect, useState } from "react"; // React

export function useDebounced<T>(value: T, delayMs = 250): T { // value that only updates after the user stops typing
  const [debounced, setDebounced] = useState(value); // last settled value
  useEffect(() => { // restart the timer on every change
    const timer = window.setTimeout(() => setDebounced(value), delayMs); // settle after the delay
    return () => window.clearTimeout(timer); // typing again cancels the previous timer
  }, [value, delayMs]); // when the input changes
  return debounced; // settled value
}
