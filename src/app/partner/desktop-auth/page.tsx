'use client';

import { useSession, signIn } from 'next-auth/react';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function DesktopAuthContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const callback = searchParams?.get('callback');
    
    if (!callback) {
      setError('No callback URL provided by the desktop app.');
      return;
    }

    if (status === 'unauthenticated') {
      // Not logged in, redirect to signin and return here afterwards
      signIn('google', { callbackUrl: `/partner/desktop-auth?callback=${encodeURIComponent(callback)}` });
    } else if (status === 'authenticated') {
      // Fetch the raw JWT token for the desktop app (will auto-upgrade to partner)
      fetch('/api/partner/desktop-token')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            // Redirect back to the local desktop app server
            const redirectUrl = new URL(callback);
            redirectUrl.searchParams.append('partnerId', data.partnerId);
            redirectUrl.searchParams.append('token', data.token);
            window.location.href = redirectUrl.toString();
          } else {
            setError(data.error || 'Failed to generate desktop token.');
          }
        })
        .catch(err => {
          console.error(err);
          setError('Network error while generating token.');
        });
    }
  }, [status, session, searchParams]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 text-gray-900">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border-t-4 border-red-500">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">Authentication Failed</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <p className="text-sm text-gray-400">You can close this window and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50 text-gray-900">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border-t-4 border-indigo-500">
        <div className="w-16 h-16 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">Connecting to Desktop App...</h2>
        <p className="text-gray-600">Please wait while we securely authenticate your hardware.</p>
      </div>
    </div>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-gray-50"></div>}>
      <DesktopAuthContent />
    </Suspense>
  );
}
