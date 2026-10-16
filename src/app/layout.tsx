import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/literata";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import { TopBar } from "@/components/TopBar";
import { RevealRoot } from "@/components/Reveal";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: { default: "MarkMyWords — answer-writing coach", template: "%s · MarkMyWords" },
  description:
    "Write first. Get evidence-linked feedback on UPSC Mains answers, fix them yourself, and prove the fix holds on a fresh question. AI estimates, never official marks.",
  applicationName: "MarkMyWords",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#171411" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0a08" },
  ],
  width: "device-width",
  initialScale: 1,
};

const themeScript = `try{var t=localStorage.getItem("mmw-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {getEnv().ephemeralStorage && (
          <div className="storage-banner" role="status">
            Preview mode: no database is connected, so accounts and answers may reset. Connect a hosted
            database (TURSO_DATABASE_URL) to keep them.
          </div>
        )}
        <TopBar />
        <main id="main">{children}</main>
        <RevealRoot />
      </body>
    </html>
  );
}
