'use client';

import { useState, useEffect } from 'react';

interface AdminOTPAuthProps {
  onLogin: () => void;
  title?: string;
  subtitle?: string;
}

export default function AdminOTPAuth({ 
  onLogin, 
  title = "Admin Access", 
  subtitle = "Enter OTP sent to your email to access admin dashboard" 
}: AdminOTPAuthProps) {
  const [step, setStep] = useState<'otp'>('otp');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Automatically send OTP when component mounts
  useEffect(() => {
    const sendInitialOTP = async () => {
      if (!otpSent) {
        setIsLoading(true);
        setError('');

        try {
          console.log('Sending OTP to adityapandey.dev.in@gmail.com');
          const response = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL) }),
          });

          const data = await response.json();
          console.log('OTP response:', data);

          if (data.success) {
            setOtpSent(true);
            console.log('OTP sent successfully');
          } else {
            setError(data.error || 'Failed to send OTP');
          }
        } catch (error) {
          console.error('Error sending OTP:', error);
          setError('Failed to send OTP. Please try again.');
        } finally {
          setIsLoading(false);
        }
      }
    };

    sendInitialOTP();
  }, [otpSent]);

  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL), 
          otp: otp 
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Store admin session
        localStorage.setItem('adminAuthenticated', 'true');
        localStorage.setItem('adminLoginTime', Date.now().toString());
        onLogin();
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (error) {
      console.error('Error verifying OTP:', error);
      setError('Failed to verify OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL) }),
      });

      const data = await response.json();

      if (data.success) {
        setError('');
        alert('OTP sent successfully!');
      } else {
        setError(data.error || 'Failed to resend OTP');
      }
    } catch (error) {
      console.error('Error resending OTP:', error);
      setError('Failed to resend OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {title}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {subtitle}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleOTPSubmit}>
          <div>
            <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
              Enter OTP
            </label>
            <input
              id="otp"
              name="otp"
              type="text"
              required
              maxLength={6}
              className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-black focus:border-black focus:z-10 sm:text-sm text-center text-2xl tracking-widest"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
            <p className="mt-2 text-sm text-gray-500 text-center">
              Check your email: adityapandey.dev.in@gmail.com
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="submit"
              disabled={isLoading || otp.length !== 6}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Verifying...' : 'Verify OTP'}
            </button>

            <button
              type="button"
              onClick={handleResendOTP}
              disabled={isLoading}
              className="w-full py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Resend OTP
            </button>
          </div>
        </form>

        <div className="text-center">
          <p className="text-xs text-gray-500">
            Secure admin access with OTP verification
          </p>
        </div>
      </div>
    </div>
  );
}
