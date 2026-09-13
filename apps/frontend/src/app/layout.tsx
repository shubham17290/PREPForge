// PHASE 5 §17 — app shell: providers + navbar + main landmark.
import "./../styles/globals.css";
import { AuthProvider } from "@/hooks/use-auth";
import { ToastProvider } from "@/components/ui/overlay";
import { Navbar } from "@/components/layout/navbar";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: {
    default: `${BRAND.name} · GATE CS & IT PYQ Practice`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    "Practice real GATE CS & IT previous-year questions with instant grading, explanations and weak-topic insights.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ToastProvider>
            <Navbar />
            <main id="main">{children}</main>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
