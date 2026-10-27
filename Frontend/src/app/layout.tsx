import type { Metadata, Viewport } from "next"; // page metadata types
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google"; // self-hosted Google fonts
import { Providers } from "@/components/providers"; // theme + data + auth providers
import { Toaster } from "@/components/ui/sonner"; // toast host
import { PAPER_DARK, PAPER_LIGHT } from "@/lib/token-hex"; // meta tags can't read CSS variables
import "./globals.css"; // Tailwind + Cobalt tokens

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" }); // display face (headings, big numbers)
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" }); // body face
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" }); // data face (student numbers, times)

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Biometric Attendance"; // product name (spec U5)

export const metadata: Metadata = { // <head> tags
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, // "Sessions · Biometric Attendance"
  description: "Lecturer and administrator dashboard for fingerprint attendance.", // search/preview text
  applicationName: APP_NAME, // PWA / OS name
};

export const viewport: Viewport = { // mobile browser chrome
  themeColor: [ // address-bar colour follows the theme
    { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT }, // = --color-paper (light)
    { media: "(prefers-color-scheme: dark)", color: PAPER_DARK }, // = --color-paper (dark)
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) { // wraps every route
  return (
    // font variables on <html>; suppressHydrationWarning because next-themes sets the class before React hydrates
    <html lang="en-ZA" className={`${spaceGrotesk.variable} ${plexSans.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        {/* theme, data cache, auth, tooltips */}
        <Providers>
          {children}
          {/* toasts stack in the top-right corner and never shift the page */}
          <Toaster richColors position="top-right" closeButton />
        </Providers>
      </body>
    </html>
  );
}
