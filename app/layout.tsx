import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { CartProvider } from '@/contexts/CartContext';
import NavBar from './NavBar';

export const metadata: Metadata = {
  title: {
    default: 'Headless WP',
    template: '%s | Headless WP',
  },
  description: 'Next.js 14 + WordPress REST API — headless CMS demo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isAuthenticated = !!cookies().get('member_token')?.value;
  return (
    <html lang="en">
      <body>
        {/* CartProvider wraps the entire app so any Client Component can call useCart().
            It lives here (root layout) rather than in a page because the cart icon in
            the nav needs the same state as the /cart page and the /articles ArticleCards.
            Server Components are unaffected — they never call useCart(). */}
        <CartProvider>
          <NavBar isAuthenticated={isAuthenticated} />
          <div id="main-content">{children}</div>
        </CartProvider>
      </body>
    </html>
  );
}
