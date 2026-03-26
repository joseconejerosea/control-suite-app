import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}