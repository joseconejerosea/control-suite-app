import "./globals.css";
import { Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const instrumentSerif = Instrument_Serif({subsets:['latin'],weight:'400',variable:'--font-display'});
const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'});

export const metadata = {
  title: "App Control Suite",
  description: "Operational platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, instrumentSerif.variable, jetbrainsMono.variable)}>
      <body>{children}</body>
    </html>
  );
}