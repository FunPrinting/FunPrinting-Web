'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

interface OrderVerifyData {
  orderId: string;
  orderStatus: string;
  status: string;
  customerName: string;
  customerEmail: string;
  fullEmail: string;
  amount: number;
  createdAt: string;
  deliveryOption: string;
  deliveryVerifiedAt?: string;
}

type VerifyStep = 'loading' | 'order-info' | 'otp-input' | 'success' | 'error';

export default function VerifyOrderPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [step, setStep] = useState<VerifyStep>('loading');
  const [order, setOrder] = useState<OrderVerifyData | null>(null);
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [updating, setUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Derived state
  const isAdmin = user?.email?.toLowerCase() === (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL)?.toLowerCase();
  const isOrderOwner = !!(user?.email && order?.fullEmail && user.email.toLowerCase() === order.fullEmail.toLowerCase());

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/verify/update-status?orderId=${orderId}`);
      const data = await res.json();
      if (data.success) {
        setOrder(data.order);
        setStep('order-info');
      } else {
        setError(data.error || 'Order not found');
        setStep('error');
      }
    } catch {
      setError('Failed to load order details');
      setStep('error');
    }
  }, [orderId]);

  useEffect(() => {
    if (orderId && !authLoading) {
      fetchOrder();
    }
  }, [orderId, authLoading, fetchOrder]);

  const handleSendOtp = async () => {
    if (!order) return;
    setOtpSending(true);
    try {
      const res = await fetch('/api/orders/verify/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, email: order.fullEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        setStep('otp-input');
      } else {
        setError(data.error || 'Failed to send OTP');
      }
    } catch {
      setError('Failed to send OTP');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    setVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/orders/verify/confirm-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, otp }),
      });
      const data = await res.json();
      if (data.success) {
        setVerificationToken(data.verificationToken);
        setStep('order-info');
        setOtpSent(false);
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch {
      setError('Failed to verify OTP');
    } finally {
      setVerifying(false);
    }
  };

  const handleUpdateStatus = async (action: 'dispatch' | 'deliver') => {
    setUpdating(true);
    setError('');
    try {
      const res = await fetch('/api/orders/verify/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          action,
          verificationToken: verificationToken || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message);
        setStep('success');
      } else {
        setError(data.error || 'Failed to update order');
      }
    } catch {
      setError('Failed to update order status');
    } finally {
      setUpdating(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      processing: 'bg-blue-100 text-blue-800 border-blue-300',
      printing: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      printed: 'bg-teal-100 text-teal-800 border-teal-300',
      dispatched: 'bg-purple-100 text-purple-800 border-purple-300',
      delivered: 'bg-green-100 text-green-800 border-green-300',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  // LOADING STATE
  if (step === 'loading' || authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white/80 text-sm">Loading order details...</p>
        </div>
      </div>
    );
  }

  // ERROR STATE
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full text-center border border-white/20">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-red-300 mb-6">{error}</p>
          <button
            onClick={() => { setError(''); setStep('loading'); fetchOrder(); }}
            className="bg-white/20 hover:bg-white/30 text-white px-6 py-2.5 rounded-xl transition-all font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // SUCCESS STATE
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full text-center border border-white/20">
          <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Success!</h2>
          <p className="text-green-300 text-lg mb-2">{successMessage}</p>
          <p className="text-white/60 text-sm mb-6">Order #{orderId}</p>
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-white/80 text-sm">
              {successMessage.includes('dispatched')
                ? '📦 The order has been dispatched to the customer.'
                : '✅ The order has been collected and delivered.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // OTP INPUT STATE
  if (step === 'otp-input') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full border border-white/20">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-1">Enter Verification Code</h2>
            <p className="text-white/60 text-sm">
              We sent a 6-digit OTP to <span className="text-purple-300 font-medium">{order?.customerEmail}</span>
            </p>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-3 mb-4 text-center">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <div className="mb-6">
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              className="w-full text-center text-3xl font-mono tracking-[0.5em] bg-white/5 border-2 border-white/20 rounded-xl px-4 py-4 text-white placeholder-white/30 focus:border-purple-400 focus:outline-none transition-all"
              autoFocus
            />
          </div>

          <button
            onClick={handleVerifyOtp}
            disabled={otp.length !== 6 || verifying}
            className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          >
            {verifying ? 'Verifying...' : 'Verify OTP'}
          </button>

          <button
            onClick={() => { setStep('order-info'); setOtp(''); setError(''); }}
            className="w-full text-white/60 hover:text-white/80 py-2 text-sm transition-colors"
          >
            ← Back to order details
          </button>

          <div className="text-center mt-4">
            <button
              onClick={handleSendOtp}
              disabled={otpSending}
              className="text-purple-300 hover:text-purple-200 text-sm underline transition-colors"
            >
              {otpSending ? 'Sending...' : 'Resend OTP'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MAIN ORDER INFO STATE
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full border border-white/20">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">🖨️ FunPrinting</h1>
          <p className="text-white/60 text-sm">Order Verification</p>
        </div>

        {/* Order Card */}
        {order && (
          <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Order #{order.orderId}</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(order.orderStatus)}`}>
                {order.orderStatus.charAt(0).toUpperCase() + order.orderStatus.slice(1)}
              </span>
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Customer</span>
                <span className="text-white font-medium">{order.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Amount</span>
                <span className="text-white font-medium">₹{order.amount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Order Time</span>
                <span className="text-white font-medium">{formatDate(order.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Type</span>
                <span className="text-white font-medium capitalize">{order.deliveryOption}</span>
              </div>
              {order.deliveryVerifiedAt && (
                <div className="flex justify-between">
                  <span className="text-white/50">Verified At</span>
                  <span className="text-green-300 font-medium">{formatDate(order.deliveryVerifiedAt)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Auth Status */}
        {isAuthenticated && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 mb-4 text-center">
            <p className="text-green-300 text-sm">
              ✅ Logged in as <span className="font-medium">{user?.email}</span>
              {isAdmin && <span className="ml-1 text-yellow-300">(Admin)</span>}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-3 mb-4 text-center">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Already delivered */}
        {order?.orderStatus === 'delivered' && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
            <p className="text-green-300 font-medium">✅ This order has already been delivered</p>
          </div>
        )}

        {/* Action Buttons */}
        {order && order.orderStatus !== 'delivered' && (
          <div className="space-y-3">
            {/* Admin: Dispatch Button */}
            {isAdmin && order.orderStatus !== 'dispatched' && (
              <button
                onClick={() => handleUpdateStatus('dispatch')}
                disabled={updating}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3.5 rounded-xl font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                {updating ? 'Dispatching...' : '📦 Mark as Dispatched'}
              </button>
            )}

            {/* User: Delivered Button (logged in as owner) */}
            {(isOrderOwner || verificationToken) && (
              <button
                onClick={() => handleUpdateStatus('deliver')}
                disabled={updating}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white py-3.5 rounded-xl font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {updating ? 'Confirming...' : '✅ Mark as Delivered'}
              </button>
            )}

            {/* Admin can also deliver */}
            {isAdmin && !isOrderOwner && !verificationToken && (
              <button
                onClick={() => handleUpdateStatus('deliver')}
                disabled={updating}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white py-3.5 rounded-xl font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {updating ? 'Confirming...' : '✅ Mark as Delivered (Admin)'}
              </button>
            )}

            {/* Not logged in or not matching: OTP verification */}
            {!isAuthenticated && !verificationToken && (
              <div className="space-y-3">
                <div className="text-center">
                  <p className="text-white/50 text-sm mb-3">
                    Verify your identity to confirm delivery
                  </p>
                </div>
                <button
                  onClick={handleSendOtp}
                  disabled={otpSending}
                  className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white py-3.5 rounded-xl font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {otpSending ? 'Sending OTP...' : '📧 Verify with Email OTP'}
                </button>
              </div>
            )}

            {/* Logged in but NOT the owner and NOT admin: show OTP option */}
            {isAuthenticated && !isOrderOwner && !isAdmin && !verificationToken && (
              <div className="space-y-3">
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-center">
                  <p className="text-yellow-300 text-sm">
                    Your email doesn&apos;t match this order. Use OTP verification.
                  </p>
                </div>
                <button
                  onClick={handleSendOtp}
                  disabled={otpSending}
                  className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white py-3.5 rounded-xl font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {otpSending ? 'Sending OTP...' : '📧 Verify with Email OTP'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-white/30 text-xs">
            Powered by FunPrinting • Secure Order Verification
          </p>
        </div>
      </div>
    </div>
  );
}
