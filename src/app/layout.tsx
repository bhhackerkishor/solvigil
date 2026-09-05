import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SolVigil - Solar Performance & Fault Disambiguation",
  description: "Detect silent solar losses, disambiguate weather from faults, and maximize your solar ROI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                <a href="/" className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                    <span className="text-primary-foreground font-bold text-sm">SV</span>
                  </div>
                  <span className="font-bold text-xl">SolVigil</span>
                </a>
                <nav className="flex items-center gap-4">
                  <a href="/onboard" className="text-sm text-muted-foreground hover:text-foreground">
                    Onboard
                  </a>
                  <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
                    Dashboard
                  </a>
                  <a href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
                    Settings
                  </a>
                </nav>
              </div>
            </div>
          </header>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
