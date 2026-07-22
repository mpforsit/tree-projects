import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lean",
  icons: {
    icon: [
      { url: "/logos/favicon/favicon.ico", sizes: "48x48" },
      { url: "/logos/favicon/favicon.svg", type: "image/svg+xml" },
      { url: "/logos/favicon/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/logos/favicon/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: "/logos/favicon/apple-touch-icon.png",
  },
  manifest: "/logos/favicon/site.webmanifest",
  openGraph: {
    images: [{ url: "/logos/png/lean-og-image-1200x630.png", width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

// Applies the persisted theme before first paint (handover §2).
const themeInit = `try{var t=localStorage.getItem('lean.theme');if(t==='dark'){document.body.dataset.theme='dark';}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className={instrumentSans.className}>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
