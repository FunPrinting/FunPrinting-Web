import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import SessionProvider from '@/components/SessionProvider';
import ConditionalLayout from '@/components/ConditionalLayout';
import ErrorReporter from '@/components/ErrorReporter';
import { generateMetadata as generateSEOMetadata } from '@/lib/seo';
import connectDB from '@/lib/mongodb';
import AdminInfo from '@/models/AdminInfo';
import { cn } from '@/lib/utils';
import { headers } from 'next/headers';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });


// Generate dynamic metadata with admin info from database
export async function generateMetadata(): Promise<Metadata> {
  try {
    await connectDB();
    const adminInfo = await AdminInfo.findOne({ isActive: true }).lean() as {
      favicon?: string;
      seoTitle?: string;
      seoDescription?: string;
      seoKeywords?: string;
      ogImage?: string;
      name?: string;
    } | null;

    // Normalize favicon URL
    let faviconUrl = '/fun-printing-printing-service-favicon.jpg'; // default
    if (adminInfo?.favicon) {
      const favicon = adminInfo.favicon.trim();
      if (favicon.startsWith('http://') || favicon.startsWith('https://')) {
        // Full URL - use as-is
        faviconUrl = favicon;
      } else if (favicon.startsWith('/')) {
        // Relative path starting with / - use as-is
        faviconUrl = favicon;
      } else {
        // Relative path without / - add it
        faviconUrl = `/${favicon}`;
      }
    }

    // Use admin SEO fields if available, otherwise use defaults
    const seoConfig = {
      title: adminInfo?.seoTitle || 'Fun Printing - Professional Printing Services',
      description: adminInfo?.seoDescription || 'Fun Printing offers professional printing services including color prints, B/W prints, binding, and document templates. Fast delivery for college students. Order now for quick and affordable printing solutions.',
      keywords: adminInfo?.seoKeywords || 'fun printing, printing service, print shop, document printing, color printing, B/W printing, binding service, printing templates, college printing, student printing, online printing, print online',
      image: adminInfo?.ogImage || faviconUrl,
      siteName: adminInfo?.name || 'Fun Printing',
    };

    // Generate SEO metadata
    const seoMetadata = generateSEOMetadata(seoConfig);

    // Return metadata with dynamic icons
    return {
      ...seoMetadata,
      manifest: '/manifest.webmanifest',
      icons: {
        icon: faviconUrl,
        shortcut: faviconUrl,
        apple: faviconUrl,
      },
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    // Fallback to default metadata if there's an error
    return {
      ...generateSEOMetadata({
        title: 'Fun Printing - Professional Printing Services',
        description: 'Fun Printing offers professional printing services including color prints, B/W prints, binding, and document templates. Fast delivery for college students. Order now for quick and affordable printing solutions.',
        keywords: 'fun printing, printing service, print shop, document printing, color printing, B/W printing, binding service, printing templates, college printing, student printing, online printing, print online',
        image: '/fun-printing-printing-service-favicon.jpg',
        siteName: 'Fun Printing',
      }),
      manifest: '/manifest.webmanifest',
      icons: {
        icon: '/fun-printing-printing-service-favicon.jpg',
        shortcut: '/fun-printing-printing-service-favicon.jpg',
        apple: '/fun-printing-printing-service-favicon.jpg',
      },
    };
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || '';
  const isAdminSubdomain = host.toLowerCase().startsWith('admin.');

  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <head>
        <meta name="application-name" content="Fun Printing Store" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="FunPrinting" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#4f46e5" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{window.__deferredPwaPrompt=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__deferredPwaPrompt=e;window.dispatchEvent(new CustomEvent('pwa-prompt-ready'));});}catch(e){}})();`,
          }}
        />
        {isAdminSubdomain ? (
          <meta name="robots" content="noindex, nofollow" />
        ) : (
          <>
            <link rel="canonical" href={process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.funprinting.store'} />
            {/* Google AdSense */}
            <script 
              async 
              src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9998034438026486"
              crossOrigin="anonymous"
            ></script>
          </>
        )}
      </head>
      <body>
        <ErrorReporter />
        <SessionProvider>
          <ConditionalLayout>
            {children}
          </ConditionalLayout>
        </SessionProvider>
      </body>
    </html>
  );
}
