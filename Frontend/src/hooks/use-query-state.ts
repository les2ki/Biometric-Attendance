"use client"; // reads and writes the browser URL

import { useCallback } from "react"; // stable callback
import { useSearchParams } from "next/navigation"; // current query string

type QueryValue = string | number | boolean | null | undefined; // anything we put in the URL

export function useQueryState() { // list filters + paging live in the query string (admin spec §3.2)
  const searchParams = useSearchParams(); // ?q=…&offset=…

  const get = useCallback((key: string): string | null => searchParams.get(key), [searchParams]); // read one value

  const getNumber = useCallback((key: string, fallback: number): number => { // read a number (e.g. offset)
    const n = Number(searchParams.get(key)); // parse
    return Number.isFinite(n) && n >= 0 && searchParams.has(key) ? n : fallback; // invalid → fallback
  }, [searchParams]); // when the URL changes

  const set = useCallback((updates: Record<string, QueryValue>, opts: { resetOffset?: boolean } = { resetOffset: true }) => { // write values
    const params = new URLSearchParams(searchParams.toString()); // copy the current query
    for (const [key, value] of Object.entries(updates)) { // each change
      if (value === null || value === undefined || value === "") params.delete(key); // empty → remove
      else params.set(key, String(value)); // set
    }
    if (opts.resetOffset && !("offset" in updates)) params.delete("offset"); // a new filter starts at page 1
    const query = params.toString(); // encoded
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname); // Next.js keeps useSearchParams in sync; no server round-trip, refresh/back keep the view
  }, [searchParams]); // when the URL changes

  return { get, getNumber, set }; // the API
}
