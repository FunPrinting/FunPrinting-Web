'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { countryCodes, defaultCountryCode, validatePhoneNumber, parsePhoneNumber, needsCountryCode } from '@/lib/phoneValidation';
import { LocationIcon } from '@/components/SocialIcons';
import { PHONE_NOTICE } from '@/components/PhoneNotice';

interface PickupLocation {
  _id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isActive: boolean;
  isDefault: boolean;
  description?: string;
  contactPerson?: string;
  contactPhone?: string;
  operatingHours?: string;
  gmapLink?: string;
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [phone, setPhone] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState(defaultCountryCode);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [phoneValidation, setPhoneValidation] = useState<{ valid: boolean; error?: string }>({ valid: true });
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [pickupLocations, setPickupLocations] = useState<PickupLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [canSkip, setCanSkip] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/signin');
    }
  }, [isAuthenticated, router]);

  // Load user profile and pickup locations
  useEffect(() => {
    const loadData = async () => {
      if (!isAuthenticated) return;

      try {
        // Load user profile
        const profileResponse = await fetch('/api/user/profile');
        const profileData = await profileResponse.json();
        
        if (profileData.success && profileData.profile) {
          if (profileData.profile.phone) {
            const existingPhone = profileData.profile.phone;
            // Check if phone needs country code (legacy 10-digit)
            if (needsCountryCode(existingPhone)) {
              // Legacy number - set country code to default and number to existing
              setPhoneNumber(existingPhone);
              setPhone(`${selectedCountryCode.dialCode}${existingPhone}`);
            } else if (existingPhone.startsWith('+')) {
              // Already has country code - parse it
              const parsed = parsePhoneNumber(existingPhone);
              if (parsed) {
                const country = countryCodes.find(c => c.dialCode === parsed.countryCode) || defaultCountryCode;
                setSelectedCountryCode(country);
                setPhoneNumber(parsed.number);
                setPhone(existingPhone);
              } else {
                setPhone(existingPhone);
              }
            } else {
              setPhone(existingPhone);
            }
          }
          if (profileData.profile.defaultLocationId) {
            setSelectedLocationId(profileData.profile.defaultLocationId);
          }
        }

        // Load pickup locations
        const locationsResponse = await fetch('/api/pickup-locations');
        const locationsData = await locationsResponse.json();
        
        if (locationsData.success) {
          setPickupLocations(locationsData.locations || []);
          // Auto-select default location if no location selected
          if (!selectedLocationId && locationsData.defaultLocation) {
            setSelectedLocationId(locationsData.defaultLocation._id);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setError('Failed to load data. Please refresh the page.');
      } finally {
        setIsLoading(false);
        // Allow skip after 3 seconds
        setTimeout(() => setCanSkip(true), 3000);
      }
    };

    loadData();
  }, [isAuthenticated, selectedLocationId]);

  // Update phone when country code or number changes
  useEffect(() => {
    if (phoneNumber) {
      const fullPhone = `${selectedCountryCode.dialCode}${phoneNumber}`;
      setPhone(fullPhone);
      const validation = validatePhoneNumber(fullPhone);
      setPhoneValidation(validation);
    } else {
      setPhone('');
      setPhoneValidation({ valid: true });
    }
     
  }, [phoneNumber, selectedCountryCode.dialCode]);

  const handleSave = async (skip: boolean = false) => {
    if (!skip) {
      // Validate phone number
      if (!phone || !phoneNumber) {
        setError('Please enter a valid phone number with country code');
        return;
      }

      const validation = validatePhoneNumber(phone);
      if (!validation.valid) {
        setError(validation.error || 'Please enter a valid phone number');
        return;
      }

      if (!selectedLocationId) {
        setError('Please select a pickup location');
        return;
      }
    }

    setIsSaving(true);
    setError('');

    try {
      // Save phone number if provided
      if (phone && phoneValidation.valid) {
        const phoneResponse = await fetch('/api/user/update-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        
        const phoneData = await phoneResponse.json();
        if (!phoneResponse.ok || !phoneData.success) {
          throw new Error(phoneData.error || 'Failed to save phone number');
        }
      }

      // Save default location if selected
      if (selectedLocationId) {
        const locationResponse = await fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultLocationId: selectedLocationId }),
        });
        
        if (!locationResponse.ok) {
          throw new Error('Failed to save pickup location');
        }
      }

      // Redirect to order page
      router.push('/order');
    } catch (error) {
      console.error('Error saving profile:', error);
      setError('Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAuthenticated || isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-2">
            <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center text-white font-bold text-lg shadow-lg">
              1
            </div>
            <div className="w-24 h-1 bg-gray-900 rounded"></div>
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg">
              2
            </div>
          </div>
          <p className="text-center text-sm text-gray-600 mt-2">Step 1 of 2</p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header with Gradient */}
          <div className="bg-gradient-to-r from-gray-900 to-black p-8 text-center text-white">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-3xl font-bold mb-2">Welcome, {user?.name || 'there'}!</h1>
            <p className="text-gray-300 text-lg">Complete your profile to get started with printing</p>
          </div>

          {/* Form Content */}
          <div className="p-8 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Phone Number */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                📱 Phone Number <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                {/* Country Code Selector */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                    className="px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all bg-white hover:bg-gray-50 flex items-center gap-2 min-w-[140px]"
                  >
                    <span className="text-xl">{selectedCountryCode.flag}</span>
                    <span className="text-sm font-medium">{selectedCountryCode.dialCode}</span>
                    <span className="ml-auto">▼</span>
                  </button>
                  
                  {showCountryDropdown && (
                    <>
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setShowCountryDropdown(false)}
                      ></div>
                      <div className="absolute z-20 mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto w-64">
                        {countryCodes.map((country) => (
                          <button
                            key={country.code}
                            type="button"
                            onClick={() => {
                              setSelectedCountryCode(country);
                              setShowCountryDropdown(false);
                            }}
                            className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 ${
                              selectedCountryCode.code === country.code ? 'bg-gray-50' : ''
                            }`}
                          >
                            <span className="text-xl">{country.flag}</span>
                            <span className="flex-1 text-sm font-medium">{country.country}</span>
                            <span className="text-sm text-gray-600">{country.dialCode}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Phone Number Input */}
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/\D/g, '');
                    setPhoneNumber(digitsOnly);
                  }}
                  placeholder="Enter phone number"
                  maxLength={15}
                  className={`flex-1 px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all ${
                    phoneNumber && !phoneValidation.valid ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
              </div>
              
              {phoneNumber && !phoneValidation.valid && (
                <p className="text-red-600 text-sm mt-1">{phoneValidation.error}</p>
              )}
              
              {phoneValidation.valid && phone && (
                <p className="text-green-600 text-sm mt-1">✓ Valid phone number: {phone}</p>
              )}
              
              <p className="text-xs text-gray-500 mt-1">{PHONE_NOTICE}</p>
            </div>

            {/* Pickup Location */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                📍 Preferred Pickup Location <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto border-2 border-gray-200 rounded-lg p-2">
                {pickupLocations.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No pickup locations available</p>
                ) : (
                  pickupLocations.map((location) => (
                    <label
                      key={location._id}
                      className={`flex items-start p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedLocationId === location._id
                          ? 'border-gray-900 bg-gray-50 shadow-md'
                          : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pickupLocation"
                        value={location._id}
                        checked={selectedLocationId === location._id}
                        onChange={(e) => setSelectedLocationId(e.target.value)}
                        className="mt-1 mr-3 text-gray-900 focus:ring-gray-900"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{location.name}</div>
                        <div className="text-sm text-gray-600 mt-1">{location.address}</div>
                        {location.operatingHours && (
                          <div className="text-xs text-gray-500 mt-1">🕐 {location.operatingHours}</div>
                        )}
                        {location.gmapLink && (
                          <a
                            href={location.gmapLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="flex items-center gap-1">
                              <LocationIcon size={14} className="w-3.5 h-3.5" />
                              View on Map
                            </span>
                          </a>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">You can change this anytime in your profile</p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button
                onClick={() => handleSave(false)}
                disabled={isSaving || !phoneValidation.valid || !phone || !selectedLocationId}
                className="flex-1 bg-black text-white font-semibold py-4 px-6 rounded-lg hover:bg-gray-800 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg"
              >
                {isSaving ? (
                  <span className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Saving...
                  </span>
                ) : (
                  '✨ Save & Continue'
                )}
              </button>
              
              {canSkip && (
                <button
                  onClick={() => handleSave(true)}
                  disabled={isSaving}
                  className="sm:w-auto px-6 py-4 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Skip for now
                </button>
              )}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
              <p className="text-sm text-blue-800">
                <strong>💡 Why complete your profile?</strong>
              </p>
              <ul className="text-xs text-blue-700 mt-2 space-y-1 list-disc list-inside">
                <li>Faster checkout - your info will be auto-filled</li>
                <li>Order updates via phone</li>
                <li>Quick pickup at your preferred location</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer Link */}
        <div className="text-center mt-6">
          <Link href="/order" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Already have an account? Go to order page →
          </Link>
        </div>
      </div>
    </div>
  );
}



