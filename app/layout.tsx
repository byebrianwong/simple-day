// Only the 404 page uses this layout. The display page is served by
// app/d/[token]/route.ts as plain HTML.

export const metadata = { robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
