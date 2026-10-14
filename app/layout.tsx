import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
    title: 'กินจริง (KinJing) - รีวิวร้านอาหาร',
    description: 'คอมมูนิตี้รีวิวร้านอร่อย ปลอดหน้าม้า • รายได้แบ่งตามยอดวิว',
    openGraph: {
        title: 'กินจริง (KinJing)',
        description: 'คอมมูนิตี้รีวิวร้านอร่อย ปลอดหน้าม้า',
        url: 'https://kinjing-2jwy.vercel.app',
        siteName: 'KinJing',
        images: [
            {
                url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&h=630&fit=crop',
                width: 1200,
                height: 630,
                alt: 'กินจริง (KinJing)',
            },
        ],
        locale: 'th_TH',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'กินจริง (KinJing)',
        description: 'คอมมูนิตี้รีวิวร้านอร่อย',
        images: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&h=630&fit=crop'],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="th">
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                {children}
            </body>
        </html>
    );
}
