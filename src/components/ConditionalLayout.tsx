'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Toaster } from 'react-hot-toast';

interface ConditionalLayoutProps {
  children: React.ReactNode;
}

export default function ConditionalLayout({ children }: ConditionalLayoutProps) {
  const pathname = usePathname();
  const [isAdminSubdomain, setIsAdminSubdomain] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname.toLowerCase();
      const parts = hostname.split('.');
      const isLocal = hostname.includes('localhost') || hostname === '127.0.0.1';
      setIsAdminSubdomain(parts.length > (isLocal ? 1 : 2) && parts[0] === 'admin');
    }
  }, []);

  // Check if current view is an admin route or on the admin subdomain
  const isAdminView = pathname.startsWith('/admin') || isAdminSubdomain;

  if (isAdminView) {
    // For admin portal, never show customer navbar or customer footer
    return (
      <div className="min-h-screen">
        {children}
      </div>
    );
  }

  // For regular customer routes, show customer navbar and footer
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          className: '!rounded-xl !border !bg-popover !text-popover-foreground !shadow-lg !text-sm',
        }}
      />
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main id="main" className="flex-grow">
          {children}
        </main>
        <Footer />
      </div>
    </>
  );
}
