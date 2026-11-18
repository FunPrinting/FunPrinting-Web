'use client';

import { useState, useEffect } from 'react';
import { CheckIcon, WarningIcon, RefreshIcon } from '@/components/SocialIcons';
import { PHONE_NOTICE } from '@/components/PhoneNotice';

interface InlinePhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPhoneSaved: (phone: string) => void; // Callback when phone is saved
}

export default function InlinePhoneModal({
  isOpen,
  onClose,
  onPhoneSaved,
}: InlinePhoneModalProps) {
  const [phone, setPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPhone('');
      setError('');
      setSaveStatus('idle');
    }
  }, [isOpen]);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleSave = async () => {
    // Validate phone number before saving
    if (!phone) {
      setError('Please enter a phone number');
      setSaveStatus('error');
      return;
    }

    // Strip non-digit characters for validation
    const digitsOnly = phone.replace(/\D/g, '');
    
    // Only save if phone number has at least 10 digits
    if (digitsOnly.length < 10) {
      setError('Please enter a valid phone number (minimum 10 digits)');
      setSaveStatus('error');
      return;
    }

    setIsSaving(true);
    setError('');
    setSaveStatus('idle');

    try {
      const response = await fetch('/api/user/update-phone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone }),
      });
      
      const data = await response.json();
      if (data.success) {
        console.log('✅ Phone number saved to profile');
        setSaveStatus('success');
        // Call callback and close modal after short delay
        setTimeout(() => {
          onPhoneSaved(phone);
          onClose();
        }, 1000);
      } else {
        throw new Error(data.error || 'Failed to save phone number');
      }
    } catch (error) {
      console.error('Error saving phone number:', error);
      setError('Failed to save phone number. Please try again.');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full transform transition-all">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="p-6">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Add Phone Number
              </h2>
              <p className="text-sm text-gray-600">
                Please enter your phone number to continue with your order
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
                {error}
              </div>
            )}

            {/* Success message */}
            {saveStatus === 'success' && (
              <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm flex items-center gap-2">
                <CheckIcon size={16} className="w-4 h-4" />
                Phone number saved successfully!
              </div>
            )}

            {/* Phone input */}
            <div className="mb-4">
              <label htmlFor="phone-input" className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number *
              </label>
              <input
                id="phone-input"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError('');
                  setSaveStatus('idle');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                placeholder="98765 43210"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSaving}
              />
              {phone && phone.replace(/\D/g, '').length < 10 && phone.replace(/\D/g, '').length > 0 && (
                <p className="text-xs text-red-600 mt-1">Phone number must be at least 10 digits</p>
              )}
              <p className="text-xs text-gray-500 mt-1">{PHONE_NOTICE}</p>
            </div>

            {/* Submit button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !phone || phone.replace(/\D/g, '').length < 10}
              className={`w-full px-4 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                isSaving
                  ? 'bg-blue-400 text-white cursor-not-allowed'
                  : saveStatus === 'success'
                  ? 'bg-green-500 text-white'
                  : saveStatus === 'error'
                  ? 'bg-red-500 text-white'
                  : phone && phone.replace(/\D/g, '').length >= 10
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <>
                  <RefreshIcon size={16} className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : saveStatus === 'success' ? (
                <>
                  <CheckIcon size={16} className="w-4 h-4" />
                  <span>Saved!</span>
                </>
              ) : saveStatus === 'error' ? (
                <>
                  <WarningIcon size={16} className="w-4 h-4" />
                  <span>Error - Try Again</span>
                </>
              ) : (
                <span>Save Phone Number</span>
              )}
            </button>

            {/* Info text */}
            <p className="text-xs text-gray-500 mt-4 text-center">
              We&apos;ll use this to contact you about your orders
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

