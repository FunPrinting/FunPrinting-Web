'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PrinterIcon, DollarIcon, RocketIcon } from '@/components/SocialIcons';

export default function PartnerPage() {
  const [downloadLink, setDownloadLink] = useState('https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.exe');
  const [downloadText, setDownloadText] = useState('Download Desktop App');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userAgent = window.navigator.userAgent.toLowerCase();
      if (userAgent.indexOf('android') !== -1) {
        setDownloadText('Download Android App');
        setDownloadLink('https://github.com/FunPrinting/partner-mobile/releases/latest/download/FunPrintingPartner.apk');
      } else if (userAgent.indexOf('iphone') !== -1 || userAgent.indexOf('ipad') !== -1) {
        setDownloadText('Mobile App Coming Soon');
        setDownloadLink('#');
      } else if (userAgent.indexOf('mac') !== -1) {
        setDownloadText('Download for Mac');
        setDownloadLink('https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.dmg'); // .dmg or .zip depending on your release format
      } else if (userAgent.indexOf('win') !== -1) {
        setDownloadText('Download for Windows');
        setDownloadLink('https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.exe');
      } else {
        setDownloadText('Download Desktop App');
      }
    }
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-900 pb-20">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-indigo-600 via-blue-700 to-indigo-900 text-white overflow-hidden relative">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
              Turn your printer into a <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-500">money-making</span> machine.
            </h1>
            <p className="text-lg md:text-xl text-blue-100 mb-10 leading-relaxed">
              Join the Fun Printing marketplace. We bring local customers to you. Just leave your printer on, and we handle the rest—from zero-config secure connections to split payouts.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link 
                href="/auth/signin?callbackUrl=/partner/dashboard"
                className="px-8 py-4 bg-white text-indigo-600 rounded-full font-bold text-lg shadow-lg hover:shadow-xl hover:bg-gray-50 transition-all transform hover:-translate-y-1"
              >
                Become a Partner
              </Link>
              <a 
                href={downloadLink}
                className="px-8 py-4 bg-transparent border-2 border-white text-white rounded-full font-bold text-lg hover:bg-white/10 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                {downloadText}
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* How it Works */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-bold text-center mb-16 text-gray-800">How the Franchise Works</h2>
        
        <div className="grid md:grid-cols-3 gap-12">
          {/* Step 1 */}
          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-50 rounded-full z-0 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative z-10">
              <div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center mb-6 shadow-md text-white">
                <span className="text-2xl font-bold">1</span>
              </div>
              <h3 className="text-xl font-bold mb-4 text-gray-900">Download & Connect</h3>
              <p className="text-gray-600 leading-relaxed">
                Download our secure Desktop App for Windows/Mac. It automatically detects your connected USB or WiFi printers. No complex port-forwarding needed.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-indigo-50 rounded-full z-0 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative z-10">
              <div className="w-14 h-14 bg-indigo-600 rounded-xl flex items-center justify-center mb-6 shadow-md text-white">
                <span className="text-2xl font-bold">2</span>
              </div>
              <h3 className="text-xl font-bold mb-4 text-gray-900">Set Your Pricing</h3>
              <p className="text-gray-600 leading-relaxed">
                Log into your dashboard, set your own rates for Black & White or Color prints, and mark your shop as &quot;Online&quot; to appear on the customer map.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-green-50 rounded-full z-0 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative z-10">
              <div className="w-14 h-14 bg-green-600 rounded-xl flex items-center justify-center mb-6 shadow-md text-white">
                <span className="text-2xl font-bold">3</span>
              </div>
              <h3 className="text-xl font-bold mb-4 text-gray-900">Auto-Print & Earn</h3>
              <p className="text-gray-600 leading-relaxed">
                Customers order via the web. Our cloud tunnel automatically pushes the job to your printer. You fulfill the order, and earnings are routed to your bank account.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Download Section */}
      <div id="download" className="bg-gray-50 py-20 border-t border-gray-200">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-6 text-gray-900">Get the Partner App</h2>
          <p className="text-lg text-gray-600 mb-10">
            Powered by Electron for deep hardware integration. Available for Windows and macOS.
          </p>
          
          <div className="flex flex-col sm:flex-row justify-center gap-6">
            {downloadText === 'Download Android App' ? (
              <a href="https://github.com/FunPrinting/partner-mobile/releases/latest/download/FunPrintingPartner.apk" className="flex items-center justify-center gap-3 px-8 py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg hover:shadow-xl">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                Download Android App
              </a>
            ) : downloadText === 'Mobile App Coming Soon' ? (
              <button disabled className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-300 text-gray-600 rounded-xl font-bold cursor-not-allowed shadow-sm">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                Mobile App Coming Soon
              </button>
            ) : (
              <>
                <a href="https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.exe" className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                  Download for Windows
                </a>
                <a href="https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.dmg" className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-100 border border-gray-300 text-gray-800 rounded-xl font-bold hover:bg-gray-200 transition-all shadow-sm">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91 1.65.17 3.19.9 4.14 2.33-3.66 2.01-3.12 7.02.65 8.33-.24.63-.53 1.34-.88 2.08zm-4.73-15.5c.8-1.04 1.35-2.49 1.19-3.95-1.28.06-2.82.9-3.65 1.93-.72.88-1.38 2.37-1.18 3.79 1.45.13 2.84-.71 3.64-1.77z"/></svg>
                  Download for Mac
                </a>
              </>
            )}
          </div>
          <p className="mt-6 text-sm text-gray-500">Version 1.0.0 • Requires Windows 10+ or macOS 11+</p>
        </div>
      </div>
    </div>
  );
}
