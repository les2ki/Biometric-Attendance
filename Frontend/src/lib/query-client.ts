import { QueryClient } from "@tanstack/react-query"; // TanStack Query cache
import { ApiError } from "@/lib/api"; // to tell 4xx errors apart

export function makeQueryClient(): QueryClient { // one client per browser tab
  return new QueryClient({ // shared defaults for every query/mutation
    defaultOptions: { // see spec §4.2
      queries: { // reads
        staleTime: 10_000, // data younger than 10 s is reused without refetching
        refetchOnWindowFocus: true, // coming back to the tab refreshes data
        retry: (failureCount, error) => { // decide whether to retry a failed read
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false; // 4xx won't fix itself
          return failureCount < 2; // network/5xx: try up to 2 more times
        },
      },
      mutations: { // writes
        retry: false, // never repeat a write automatically
      },
    },
  });
}
