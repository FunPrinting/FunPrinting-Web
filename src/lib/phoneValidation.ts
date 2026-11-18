// Phone number validation utilities

export interface CountryCode {
  code: string;
  country: string;
  flag: string;
  dialCode: string;
}

// Common country codes with flags (using emoji flags)
export const countryCodes: CountryCode[] = [
  { code: 'IN', country: 'India', flag: '🇮🇳', dialCode: '+91' },
  { code: 'US', country: 'United States', flag: '🇺🇸', dialCode: '+1' },
  { code: 'GB', country: 'United Kingdom', flag: '🇬🇧', dialCode: '+44' },
  { code: 'CA', country: 'Canada', flag: '🇨🇦', dialCode: '+1' },
  { code: 'AU', country: 'Australia', flag: '🇦🇺', dialCode: '+61' },
  { code: 'DE', country: 'Germany', flag: '🇩🇪', dialCode: '+49' },
  { code: 'FR', country: 'France', flag: '🇫🇷', dialCode: '+33' },
  { code: 'IT', country: 'Italy', flag: '🇮🇹', dialCode: '+39' },
  { code: 'ES', country: 'Spain', flag: '🇪🇸', dialCode: '+34' },
  { code: 'NL', country: 'Netherlands', flag: '🇳🇱', dialCode: '+31' },
  { code: 'BR', country: 'Brazil', flag: '🇧🇷', dialCode: '+55' },
  { code: 'MX', country: 'Mexico', flag: '🇲🇽', dialCode: '+52' },
  { code: 'JP', country: 'Japan', flag: '🇯🇵', dialCode: '+81' },
  { code: 'CN', country: 'China', flag: '🇨🇳', dialCode: '+86' },
  { code: 'KR', country: 'South Korea', flag: '🇰🇷', dialCode: '+82' },
  { code: 'SG', country: 'Singapore', flag: '🇸🇬', dialCode: '+65' },
  { code: 'AE', country: 'UAE', flag: '🇦🇪', dialCode: '+971' },
  { code: 'SA', country: 'Saudi Arabia', flag: '🇸🇦', dialCode: '+966' },
  { code: 'ZA', country: 'South Africa', flag: '🇿🇦', dialCode: '+27' },
  { code: 'NZ', country: 'New Zealand', flag: '🇳🇿', dialCode: '+64' },
];

// Default country code (India)
export const defaultCountryCode = countryCodes[0];

// Country code to minimum phone number length mapping (ITU standards)
// Minimum length is for the phone number part (excluding country code)
export const countryCodeMinLengths: Record<string, number> = {
  '+91': 10,  // India
  '+1': 10,   // US/Canada
  '+44': 10,  // UK
  '+61': 9,   // Australia
  '+49': 10,  // Germany
  '+33': 9,   // France
  '+39': 9,   // Italy
  '+34': 9,   // Spain
  '+31': 9,   // Netherlands
  '+55': 10,  // Brazil
  '+52': 10,  // Mexico
  '+81': 10,  // Japan
  '+86': 11,  // China
  '+82': 9,   // South Korea
  '+65': 8,   // Singapore
  '+971': 9,  // UAE
  '+966': 9,  // Saudi Arabia
  '+27': 9,   // South Africa
  '+64': 8,   // New Zealand
};

/**
 * Validate phone number with country code
 * Format: +{countryCode}{phoneNumber}
 * Country code: 1-3 digits
 * Phone number: 7-15 digits
 */
export function validatePhoneNumber(phone: string): { valid: boolean; error?: string; formatted?: string } {
  if (!phone) {
    return { valid: false, error: 'Phone number is required' };
  }

  // Remove all spaces and dashes for validation
  const cleaned = phone.replace(/[\s-]/g, '');

  // Must start with +
  if (!cleaned.startsWith('+')) {
    return { valid: false, error: 'Phone number must include country code (e.g., +91 for India)' };
  }

  // Check format: + followed by 1-3 digits (country code) then 7-15 digits
  const phoneRegex = /^\+[1-9]\d{1,2}\d{7,15}$/;
  
  if (!phoneRegex.test(cleaned)) {
    return { 
      valid: false, 
      error: 'Invalid phone number format. Use format: +{country code}{phone number} (e.g., +919876543210)' 
    };
  }

  // Check total length (including +)
  if (cleaned.length < 8 || cleaned.length > 18) {
    return { 
      valid: false, 
      error: 'Phone number must be between 8-18 characters (including country code)' 
    };
  }

  return { valid: true, formatted: cleaned };
}

/**
 * Format phone number for display
 * Converts +919876543210 to +91 98765 43210
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone || !phone.startsWith('+')) {
    return phone;
  }

  // Extract country code and number
  const match = phone.match(/^\+(\d{1,3})(\d+)$/);
  if (!match) {
    return phone;
  }

  const [, countryCode, number] = match;
  
  // Format number with spaces (group of 5, then remaining)
  let formattedNumber = '';
  for (let i = 0; i < number.length; i += 5) {
    if (formattedNumber) formattedNumber += ' ';
    formattedNumber += number.substring(i, i + 5);
  }

  return `+${countryCode} ${formattedNumber}`;
}

/**
 * Parse phone number to extract country code and number
 */
export function parsePhoneNumber(phone: string): { countryCode: string; number: string } | null {
  if (!phone || !phone.startsWith('+')) {
    return null;
  }

  const match = phone.match(/^\+(\d{1,3})(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    countryCode: `+${match[1]}`,
    number: match[2]
  };
}

/**
 * Get country code by dial code
 */
export function getCountryByDialCode(dialCode: string): CountryCode | undefined {
  return countryCodes.find(country => country.dialCode === dialCode);
}

/**
 * Check if existing phone number needs country code (legacy 10-digit numbers)
 */
export function needsCountryCode(phone: string): boolean {
  if (!phone) return false;
  // If it's already in international format, no need to add country code
  if (phone.startsWith('+')) return false;
  // If it's a 10-digit number, likely needs country code
  return /^\d{10}$/.test(phone);
}

/**
 * Validate phone number length based on country code minimum requirements
 * Returns validation result indicating if phone number meets minimum length for its country code
 */
export function validatePhoneNumberLength(phone: string): { valid: boolean; error?: string } {
  if (!phone) {
    return { valid: false, error: 'Phone number is required' };
  }

  // Remove all spaces and dashes for validation
  const cleaned = phone.replace(/[\s-]/g, '');

  // Must start with +
  if (!cleaned.startsWith('+')) {
    return { valid: false, error: 'Phone number must include country code (e.g., +91 for India)' };
  }

  // Parse country code and number
  const parsed = parsePhoneNumber(cleaned);
  if (!parsed) {
    return { valid: false, error: 'Invalid phone number format' };
  }

  const { countryCode, number } = parsed;

  // Check if we have minimum length requirement for this country code
  const minLength = countryCodeMinLengths[countryCode];
  if (!minLength) {
    // If country code not in our list, use general validation (7 digits minimum)
    if (number.length < 7) {
      return { valid: false, error: `Phone number must be at least 7 digits for country code ${countryCode}` };
    }
    return { valid: true };
  }

  // Check if number meets minimum length requirement
  if (number.length < minLength) {
    return { 
      valid: false, 
      error: `Phone number for ${countryCode} must be at least ${minLength} digits (got ${number.length})` 
    };
  }

  return { valid: true };
}


/**
 * Normalises what people type: "98765 43210", "098765 43210" and "+91 98765 43210"
 * all become "+919876543210". Numbers without a country code are taken as Indian.
 * Returns the E.164 number, or an error to show.
 */
export function normalisePhoneInput(input: unknown): { ok: true; phone: string } | { ok: false; error: string } {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Phone number is required' };
  const raw = input.trim();
  let digits = raw.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    digits = digits.replace(/^0+/, '');
    if (/^[6-9]\d{9}$/.test(digits)) digits = `+91${digits}`;
    else if (/^91[6-9]\d{9}$/.test(digits)) digits = `+${digits}`;
    else return { ok: false, error: 'Enter a 10-digit mobile number, or include the country code (e.g. +91)' };
  }
  if (digits.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(digits)) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number' };
  const format = validatePhoneNumber(digits);
  if (!format.valid) return { ok: false, error: format.error || 'Invalid phone number' };
  const length = validatePhoneNumberLength(digits);
  if (!length.valid) return { ok: false, error: length.error || 'Invalid phone number' };
  return { ok: true, phone: digits };
}
