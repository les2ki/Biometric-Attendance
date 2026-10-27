"use client"; // providers hold client-side state

import { useState, type ReactNode } from "react"; // React
import { QueryClientProvider } from "@tanstack/react-query"; // data cache provider
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"; // cache inspector (dev only)
import { ThemeProvider } from "next-themes"; // light/dark switching
import { TooltipProvider } from "@/components/ui/tooltip"; // shared tooltip timing
import { AuthProvider } from "@/lib/auth"; // login state
import { makeQueryClient } from "@/lib/query-client"; // our QueryClient defaults

export function Providers({ children }: { children: ReactNode }) { // wraps every page (root layout)
  const [queryClient] = useState(makeQueryClient); // one client per browser tab, created once

  return (
    // theme first: adds class="dark" on <html> when needed
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/* data cache: every useQuery/useMutation talks to this client */}
      <QueryClientProvider client={queryClient}>
        {/* auth needs the query client (it clears the cache on logout) */}
        <AuthProvider>
          {/* tooltips: 800 ms hover delay, instant on keyboard focus (Hallmark) */}
          <TooltipProvider delayDuration={800}>{children}</TooltipProvider>
        </AuthProvider>
        {/* devtools only in `npm run dev` */}
        {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
