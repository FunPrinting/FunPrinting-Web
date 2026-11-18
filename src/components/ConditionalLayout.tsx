'use client';

import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Toaster } from 'react-hot-toast';

interface ConditionalLayoutProps {
  children: React.ReactNode;
}

export default function ConditionalLayout({ children }: ConditionalLayoutProps) {
  const pathname = usePathname();
  
  // Check if current route is an admin route
  const isAdminRoute = pathname.startsWith('/admin');
  
  if (isAdminRoute) {
    // For admin routes, don't show navbar or footer
    return (
      <div className="min-h-screen">
        {children}
      </div>
    );
  }
  
  // For regular routes, show navbar and footer
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
