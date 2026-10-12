import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Why Brain — Decision workspace",
  description: "Follow the evidence behind decisions, their replacements, and new proposals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
