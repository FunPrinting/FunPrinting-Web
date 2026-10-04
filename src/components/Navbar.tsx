'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAdminInfo } from '@/hooks/useAdminInfo';
import { useAuth } from '@/hooks/useAuth';
import dynamic from 'next/dynamic';

const ClientAuthSection = dynamic(() => import('./ClientAuthSection'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center space-x-3">
      <div className="w-20 h-6 bg-gray-200 rounded animate-pulse"></div>
      <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
    </div>
  )
});

const ClientMobileAuthSection = dynamic(() => import('./ClientMobileAuthSection'), {
  ssr: false,
  loading: () => (
    <div className="px-3 py-2">
      <div className="w-32 h-4 bg-gray-200 rounded animate-pulse mb-3"></div>
      <div className="w-20 h-8 bg-gray-200 rounded animate-pulse"></div>
    </div>
  )
});

export default function Navbar() {
  const { adminInfo } = useAdminInfo();
  const { isAuthenticated } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/order', label: 'Order Prints' },
    { href: '/cart', label: '🛒 Cart' },
    { href: '/templates', label: 'Templates' },
    { href: '/my-orders', label: 'My Orders' },
    { href: '/my-templates', label: 'My Templates', requireAuth: true },
    { href: '/contact', label: 'Contact' },
    { href: '/partner', label: 'Partner Program' },
  ].filter(link => !link.requireAuth || isAuthenticated);

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0">
              <span className="text-2xl font-bold text-black">{adminInfo?.name || 'Fun Printing Store'}</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center overflow-hidden">
            <div className="flex items-center space-x-1 xl:space-x-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-gray-700 hover:text-black px-2 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Authentication Section */}
            <div className="flex items-center ml-4 pl-4 border-l border-gray-300 shrink-0">
              <ClientAuthSection />
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-black hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-black transition-colors"
            >
              <span className="sr-only">Open main menu</span>
              {isMenuOpen ? (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMenuOpen && (
        <div className="lg:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t border-gray-200">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-gray-700 hover:text-black block px-3 py-2 rounded-md text-base font-medium transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}

            {/* Mobile Authentication Section */}
            <div className="border-t border-gray-200 pt-4 mt-4">
              <ClientMobileAuthSection onMenuClose={() => setIsMenuOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
