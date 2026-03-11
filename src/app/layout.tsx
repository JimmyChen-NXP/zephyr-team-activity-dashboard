import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Zephyr team activity dashboard",
  description: "Internal dashboard for team issue, PR, and review activity across zephyrproject-rtos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
