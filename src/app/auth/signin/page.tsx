'use client';

import { useState, useEffect, Suspense } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { AuthShell, BackHome, GoogleButton, OrDivider } from '@/components/auth/AuthShell';
import { authErrorMessage } from '@/lib/authErrors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function SignInContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showResend, setShowResend] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const resetParam = searchParams.get('reset');
    const errorParam = searchParams.get('error');
    if (resetParam === 'success') {
      setSuccess('Password reset successfully! You can now sign in with your new password.');
      // Clear the query parameter
      router.replace('/auth/signin');
      return;
    }
    const authErr = authErrorMessage(errorParam);
    if (authErr) {
      setError(authErr);
    }
  }, [searchParams, router]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        if (result.error === 'EMAIL_NOT_VERIFIED') {
          setError('Please verify your email address before signing in. Check your inbox for a verification email.');
          setShowResend(true);
        } else {
          setError('Invalid email or password');
        }
      } else {
        // Get the updated session
        const session = await getSession();
        if (session) {
          // Check if profile is complete
          try {
            const profileCheck = await fetch('/api/user/check-profile-complete');
            const profileData = await profileCheck.json();
            
            if (profileData.success && !profileData.isComplete) {
              router.push('/complete-profile');
            } else {
              router.push('/my-orders');
            }
          } catch (error) {
            console.error('Error checking profile:', error);
          router.push('/my-orders');
          }
        }
      }
    } catch (error) {
      console.error('Sign in error:', error);
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError('');

    try {
      // Redirect to a page that will check profile completeness
      await signIn('google', { callbackUrl: '/auth/check-profile' });
    } catch (error) {
      console.error('Google sign in error:', error);
      setError('Failed to sign in with Google');
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setIsResending(true);
    setError('');

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setShowResend(false);
        setSuccess('Verification email sent. Please check your inbox.');
      } else {
        setError(data.error || 'Failed to resend verification email');
      }
    } catch (error) {
      console.error('Resend verification error:', error);
      setError('An error occurred. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      description={<>New here? <Link href="/auth/signup" className="font-medium text-primary hover:underline">Create an account</Link></>}
      footer={<BackHome />}
    >
      {success ? <Alert className="border-success/30 bg-success/10 text-success"><CheckCircle2 /><AlertDescription className="text-success">{success}</AlertDescription></Alert> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {error}
            {showResend ? (
              <button type="button" onClick={handleResendVerification} disabled={isResending} className="mt-1 block font-medium underline underline-offset-2">
                {isResending ? 'Sending…' : 'Resend verification email'}
              </button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading} />
      <OrDivider />

      <form className="space-y-4" onSubmit={handleEmailSignIn}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-11" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/auth/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={isLoading}>
          {isLoading ? <Loader2 className="animate-spin" /> : null}
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60svh] items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
    }>
      <SignInContent />
    </Suspense>
  );
}
