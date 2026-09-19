import type { Metadata } from "next";
import Nav from "./components/Nav";
import { SettingsProvider } from "./store/settings";
import "./globals.css";

export const metadata: Metadata = {
  title: "medprep",
  description:
    "Exam companion for Indian MBBS professional examinations under the NMC CBME curriculum",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <SettingsProvider>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:pb-12">
            {children}
          </main>
        </SettingsProvider>
      </body>
    </html>
  );
}
