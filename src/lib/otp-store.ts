// Shared OTP store for development/testing
// In production, use Redis or database for OTP storage

interface OTPData {
  otp: string;
  timestamp: number;
  attempts: number;
}
// Max wrong attempts before an OTP is invalidated
export const MAX_OTP_ATTEMPTS = 5;

// Global variable to persist across API calls
declare global {
  var otpStoreGlobal: Map<string, OTPData> | undefined;
}

class OTPStore {
  private store: Map<string, OTPData>;

  constructor() {
    // Use global variable if it exists, otherwise create new
    if (global.otpStoreGlobal) {
      this.store = global.otpStoreGlobal;
    } else {
      this.store = new Map<string, OTPData>();
      global.otpStoreGlobal = this.store;
    }

    // Clean up expired OTPs every hour
    setInterval(() => {
      this.cleanupExpiredOTPs();
    }, 60 * 60 * 1000);
  }

  // Store OTP with timestamp
  set(email: string, otp: string): void {
    this.store.set(email, {
      otp,
      timestamp: Date.now(),
      attempts: 0
    });
  }

  // Get OTP data
  get(email: string): OTPData | undefined {
    return this.store.get(email);
  }

  // Record a failed attempt; returns the updated attempt count
  recordFailedAttempt(email: string): number {
    const data = this.store.get(email);
    if (!data) return 0;
    data.attempts += 1;
    return data.attempts;
  }
  // Remove OTP after successful verification
  delete(email: string): boolean {
    return this.store.delete(email);
  }

  // Get store size for debugging
  getStoreSize(): number {
    return this.store.size;
  }

  // Check if OTP is expired (10 minutes)
  isExpired(timestamp: number): boolean {
    const now = Date.now();
    return (now - timestamp) > 10 * 60 * 1000; // 10 minutes
  }

  // Clean up expired OTPs
  private cleanupExpiredOTPs(): void {
    for (const [email, data] of this.store.entries()) {
      if (this.isExpired(data.timestamp)) {
        this.store.delete(email);
      }
    }
  }

  // Cleanup on destroy
  destroy(): void {
    // Cleanup is handled by global variable
  }
}

// Export singleton instance
export const otpStore = new OTPStore();
