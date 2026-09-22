import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import Nav from "./components/Nav";
import { SettingsProvider } from "./store/settings";
import "./globals.css";

// =============================================================================
// FONTS
// -----------------------------------------------------------------------------
// Two faces, each doing one job.
//
//   Instrument Serif — display only. Page titles, hero numbers, empty-state
//     headlines. It is the single thing that stops this looking like a default
//     React project. Used sparingly: three or four instances per screen at
//     most, otherwise it stops being special.
//
//   Inter — everything functional. Buttons, labels, body copy, tables. Loaded
//     variable so weights 400-650 cost one file rather than four.
//
// Both are exposed as CSS variables so globals.css owns the actual
// assignment. Components never name a font directly.
// =============================================================================

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "medprep",
  description:
    "Exam companion for Indian MBBS professional examinations under the NMC CBME curriculum",
  applicationName: "medprep",
};

export const viewport: Viewport = {
  // Matches --color-canvas. Without this the mobile browser chrome stays grey
  // and the app looks like it ends an inch below the top of the screen.
  themeColor: "#fbfaf7",
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT maximumScale: 1. Blocking zoom on a study app the user
  // reads on a phone in a ward corridor is a genuine accessibility failure.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      {/*
        Colours come from globals.css via body{} — no Tailwind colour classes
        here. One source of truth for the canvas means changing the palette is
        a one-file edit, not a hunt.

        pb-32 on mobile clears the fixed bottom tab bar. pb-16 on desktop where
        that bar is hidden.
      */}
      <body className="min-h-screen antialiased">
        <SettingsProvider>
          <Nav />
          <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 md:px-6 md:pb-16">
            {children}
          </main>
        </SettingsProvider>
      </body>
    </html>
  );
}
