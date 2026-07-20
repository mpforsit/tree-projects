import type { ReactNode } from "react";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "Lean",
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
