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
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-full bg-background flex flex-col text-foreground antialiased`}>
        {/* Responsive Header */}
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 sm:h-16 sm:py-0">
              
              {/* Logo / Brand */}
              <a href="/" className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md transition-colors">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                  <span className="text-primary-foreground font-bold text-sm">SV</span>
                </div>
                <span className="font-bold text-xl tracking-tight">SolVigil</span>
              </a>

              {/* Navigation Links - Scrollable row on mobile, standard row on desktop */}
              <nav className="flex items-center gap-1 sm:gap-2 max-w-full overflow-x-auto no-scrollbar scroll-smooth py-1 sm:py-0">
                <a href="/onboard" className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  Onboard
                </a>
                <a href="/dashboard/simulator" className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors capitalize">
                  Simulator
                </a>
                <a href="/dashboard" className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  Dashboard
                </a>
                <a href="/settings" className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  Settings
                </a>
              </nav>

            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 md:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
