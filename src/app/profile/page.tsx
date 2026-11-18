'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { PHONE_NOTICE } from '@/components/PhoneNotice';

interface UserProfile {
  name: string;
  email: string;
  phone: string;
  profilePicture?: string;
  emailVerified: boolean;
  provider: 'email' | 'google';
  templateBorderPreference?: {
    style: string;
    color: string;
    width: string;
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [originalFormData, setOriginalFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [originalProfilePicture, setOriginalProfilePicture] = useState<string | null>(null);
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [templateBorderPreference, setTemplateBorderPreference] = useState({
    style: 'solid',
    color: 'blue',
    width: '2px'
  });
  const [isSavingBorderPref, setIsSavingBorderPref] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/signin');
    }
  }, [isAuthenticated, router]);

  // Load user profile
  useEffect(() => {
    const loadProfile = async () => {
      if (!isAuthenticated) return;

      try {
        const response = await fetch('/api/user/profile');
        const data = await response.json();
        
        if (data.success && data.profile) {
          const profileData: UserProfile = {
            name: data.profile.name,
            email: data.profile.email,
            phone: data.profile.phone || '',
            profilePicture: data.profile.profilePicture || user?.image,
            emailVerified: data.profile.emailVerified || false,
            provider: data.profile.provider || 'email',
            templateBorderPreference: data.profile.templateBorderPreference || {
              style: 'solid',
              color: 'blue',
              width: '2px'
            }
          };
          setProfile(profileData);
          setTemplateBorderPreference(profileData.templateBorderPreference || {
            style: 'solid',
            color: 'blue',
            width: '2px'
          });
          const initialFormData = {
            name: profileData.name,
            email: profileData.email,
            phone: profileData.phone,
          };
          setFormData(initialFormData);
          setOriginalFormData(initialFormData);
          const initialPicture = profileData.profilePicture || null;
          setProfilePicture(initialPicture);
          setOriginalProfilePicture(initialPicture);
          setImageError(false); // Reset image error on profile load
          
          // Don't require password verification on page load - only when making changes
          // Google OAuth users never need password verification
          if (profileData.provider === 'google') {
            setIsPasswordVerified(true);
          }
        }
      } catch (error) {
        console.error('Error loading profile:', error);
        setError('Failed to load profile');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [isAuthenticated, user?.image]);

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setIsVerifyingPassword(true);

    try {
      const response = await fetch('/api/user/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();
      
      if (data.success) {
        setIsPasswordVerified(true);
        setPassword('');
      } else {
        setPasswordError(data.error || 'Incorrect password');
      }
    } catch (error) {
      setPasswordError('Failed to verify password. Please try again.');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handleProfilePictureChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB');
      return;
    }

    setIsUploadingPicture(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/user/profile-picture', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (data.success && data.profilePicture) {
        const newPictureUrl = data.profilePicture;
        // Reset image error and update picture
        setImageError(false);
        setProfilePicture(newPictureUrl);
        setOriginalProfilePicture(newPictureUrl);
        setHasChanges(true);
        setSuccess('Profile picture updated successfully');
        
        // Update profile state
        if (profile) {
          setProfile({
            ...profile,
            profilePicture: newPictureUrl
          });
        }
        
        // Clear success message after 2 seconds, then reload to update session
        setTimeout(() => {
          setSuccess('');
          // Reload page to update session with new profile picture
          window.location.reload();
        }, 2000);
      } else {
        setError(data.error || 'Failed to upload profile picture');
      }
    } catch (error) {
      setError('Failed to upload profile picture. Please try again.');
    } finally {
      setIsUploadingPicture(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Track form changes
  useEffect(() => {
    const hasFormChanges = 
      formData.name !== originalFormData.name ||
      formData.email !== originalFormData.email ||
      formData.phone !== originalFormData.phone ||
      profilePicture !== originalProfilePicture;
    
    setHasChanges(hasFormChanges);
    
    // If user made changes and hasn't verified password, require verification
    if (hasFormChanges && !isPasswordVerified && profile?.provider === 'email') {
      // Don't auto-show password form, just mark that changes were made
    }
  }, [formData, originalFormData, profilePicture, originalProfilePicture, isPasswordVerified, profile?.provider]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Only require password verification if user made changes and hasn't verified
    if (hasChanges && !isPasswordVerified && profile?.provider === 'email') {
      setError('Please verify your password to save changes');
      return;
    }

    setIsSaving(true);

    try {
      // Check if email changed
      const emailChanged = formData.email !== profile?.email;
      
      // Update profile
      const updateData: any = {
        name: formData.name,
        phone: formData.phone,
      };

      // Only update email if it changed
      if (emailChanged) {
        updateData.email = formData.email;
      }

      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();
      
      if (data.success) {
        setSuccess('Profile updated successfully');
        
        // If email changed, send verification
        if (emailChanged) {
          setEmailVerificationSent(true);
          setSuccess('Profile updated. Please check your email to verify the new email address.');
        }
        
        // Reload profile
        const profileResponse = await fetch('/api/user/profile');
        const profileData = await profileResponse.json();
        if (profileData.success) {
          const updatedProfile = {
            ...profileData.profile,
            profilePicture: profilePicture || profileData.profile.profilePicture,
            emailVerified: emailChanged ? false : profileData.profile.emailVerified,
            provider: profileData.profile.provider || 'email',
          };
          setProfile(updatedProfile);
          setOriginalFormData({
            name: updatedProfile.name,
            email: updatedProfile.email,
            phone: updatedProfile.phone || '',
          });
          setOriginalProfilePicture(updatedProfile.profilePicture || null);
          setHasChanges(false);
          
          // Refresh page to update session with new profile picture
          if (profilePicture) {
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          }
        }
        
        setTimeout(() => {
          setSuccess('');
          setEmailVerificationSent(false);
        }, 5000);
      } else {
        setError(data.error || 'Failed to update profile');
      }
    } catch (error) {
      setError('Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getUserInitial = (name?: string, email?: string): string => {
    if (name) return name.charAt(0).toUpperCase();
    if (email) return email.charAt(0).toUpperCase();
    return '?';
  };

  const getInitialColor = (initial: string): string => {
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500',
      'bg-pink-500', 'bg-indigo-500', 'bg-red-500', 'bg-teal-500'
    ];
    const index = initial.charCodeAt(0) % colors.length;
    return colors[index];
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

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Failed to load profile</p>
        </div>
      </div>
    );
  }

  const initial = getUserInitial(formData.name, formData.email);
  const bgColor = getInitialColor(initial);

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Profile Settings</h1>

        {/* Profile Form - Always visible, password only required when saving changes */}
        <div className="bg-white rounded-lg shadow-md p-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
                {success}
              </div>
            )}
            {emailVerificationSent && (
              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-4">
                A verification email has been sent to your new email address. Please check your inbox and verify the email to complete the update.
              </div>
            )}

            {/* Password Verification - Only show when user tries to save changes */}
            {hasChanges && !isPasswordVerified && profile.provider === 'email' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <h3 className="text-lg font-semibold text-yellow-800 mb-2">Password Required</h3>
                <p className="text-yellow-700 mb-4">Please verify your password to save changes.</p>
                <form onSubmit={handleVerifyPassword} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                    {passwordError && (
                      <p className="text-red-600 text-sm mt-1">{passwordError}</p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isVerifyingPassword}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isVerifyingPassword ? 'Verifying...' : 'Verify Password'}
                  </button>
                </form>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
              {/* Profile Picture */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Profile Picture
                </label>
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    {profilePicture && !imageError ? (
                      <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-gray-300 relative">
                        <img
                          src={profilePicture}
                          alt="Profile"
                          className="w-full h-full object-cover"
                          onError={() => {
                            console.log('Image failed to load, showing initial');
                            setImageError(true);
                          }}
                          onLoad={() => {
                            setImageError(false);
                          }}
                        />
                      </div>
                    ) : (
                      <div className={`w-24 h-24 rounded-full ${bgColor} flex items-center justify-center text-white text-4xl font-semibold`}>
                        {initial}
                      </div>
                    )}
                    {isUploadingPicture && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                      </div>
                    )}
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePictureChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingPicture}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                      {isUploadingPicture ? 'Uploading...' : 'Change Picture'}
                    </button>
                    <p className="text-xs text-gray-500 mt-1">Max 5MB. JPG, PNG, or WebP</p>
                  </div>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    setHasChanges(true);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  disabled={hasChanges && !isPasswordVerified && profile.provider === 'email'}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({ ...formData, email: e.target.value });
                    setHasChanges(true);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  disabled={hasChanges && !isPasswordVerified && profile.provider === 'email'}
                />
                <div className="mt-2 flex items-center space-x-2">
                  {profile.emailVerified ? (
                    <span className="text-green-600 text-sm flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Verified
                    </span>
                  ) : (
                    <span className="text-yellow-600 text-sm flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Not Verified
                    </span>
                  )}
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => {
                    setFormData({ ...formData, phone: e.target.value });
                    setHasChanges(true);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+91 98765 43210"
                  disabled={hasChanges && !isPasswordVerified && profile.provider === 'email'}
                />
                <p className="text-xs text-gray-500 mt-1">{PHONE_NOTICE}</p>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end space-x-4">
                {hasChanges && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(originalFormData);
                      setProfilePicture(originalProfilePicture);
                      setHasChanges(false);
                      setImageError(false);
                      setIsPasswordVerified(false);
                      setPassword('');
                    }}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSaving || (hasChanges && !isPasswordVerified && profile.provider === 'email')}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
                </button>
              </div>
            </form>
          </div>

        {/* Template Display Preferences */}
        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Template Display Preferences</h2>
          <p className="text-sm text-gray-600 mb-6">
            Customize how your favorite templates appear on the templates page
          </p>
          
          <form onSubmit={async (e) => {
            e.preventDefault();
            setIsSavingBorderPref(true);
            setError('');
            setSuccess('');
            
            try {
              const response = await fetch('/api/user/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateBorderPreference }),
              });

              const data = await response.json();
              
              if (data.success) {
                setSuccess('Template border preferences saved successfully');
                setTimeout(() => setSuccess(''), 3000);
              } else {
                setError(data.error || 'Failed to save preferences');
              }
            } catch (error) {
              setError('Failed to save preferences. Please try again.');
            } finally {
              setIsSavingBorderPref(false);
            }
          }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Border Style */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Border Style
                </label>
                <select
                  value={templateBorderPreference.style}
                  onChange={(e) => setTemplateBorderPreference({ ...templateBorderPreference, style: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                  <option value="double">Double</option>
                  <option value="groove">Groove</option>
                  <option value="ridge">Ridge</option>
                  <option value="inset">Inset</option>
                  <option value="outset">Outset</option>
                </select>
              </div>

              {/* Border Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Border Color
                </label>
                <select
                  value={templateBorderPreference.color}
                  onChange={(e) => setTemplateBorderPreference({ ...templateBorderPreference, color: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                  <option value="purple">Purple</option>
                  <option value="gold">Gold</option>
                  <option value="red">Red</option>
                  <option value="orange">Orange</option>
                  <option value="pink">Pink</option>
                  <option value="indigo">Indigo</option>
                  <option value="teal">Teal</option>
                  <option value="gray">Gray</option>
                </select>
              </div>

              {/* Border Width */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Border Width
                </label>
                <select
                  value={templateBorderPreference.width}
                  onChange={(e) => setTemplateBorderPreference({ ...templateBorderPreference, width: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="1px">1px (Thin)</option>
                  <option value="2px">2px (Normal)</option>
                  <option value="3px">3px (Thick)</option>
                  <option value="4px">4px (Very Thick)</option>
                  <option value="5px">5px (Extra Thick)</option>
                </select>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-700 mb-2">Preview:</p>
              <div 
                className="p-4 bg-white rounded-lg inline-block"
                style={{
                  borderStyle: templateBorderPreference.style,
                  borderColor: templateBorderPreference.color === 'gold' ? '#fbbf24' : 
                               templateBorderPreference.color === 'purple' ? '#9333ea' :
                               templateBorderPreference.color === 'indigo' ? '#4f46e5' :
                               templateBorderPreference.color === 'teal' ? '#14b8a6' :
                               templateBorderPreference.color,
                  borderWidth: templateBorderPreference.width
                }}
              >
                <p className="text-sm text-gray-600">Template Card Preview</p>
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={isSavingBorderPref}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSavingBorderPref ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

