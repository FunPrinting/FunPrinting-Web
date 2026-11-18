'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { AuthShell, BackHome, GoogleButton, OrDivider } from '@/components/auth/AuthShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignUpPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showResend, setShowResend] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          phone: formData.phone,
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.emailSent) {
          setSuccess('Account created successfully! Please check your email to verify your account before signing in.');
          setShowResend(true);
        } else {
          setSuccess('Account created successfully! However, the verification email could not be sent. Please contact support.');
          setShowResend(true);
        }
        setRegisteredEmail(formData.email);
        // Clear form
        setFormData({
          name: '',
          email: '',
          password: '',
          confirmPassword: '',
          phone: '',
        });
        // Don't redirect automatically - let user read the message
      } else {
        setError(data.error || 'Failed to create account');
      }
    } catch (error) {
      console.error('Sign up error:', error);
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
    const email = registeredEmail || formData.email;
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
        setSuccess('Verification email sent successfully! Please check your inbox.');
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
      title="Create your account"
      description={<>Already have one? <Link href="/auth/signin" className="font-medium text-primary hover:underline">Sign in</Link></>}
      footer={<BackHome />}
    >
      {success ? (
        <Alert className="border-success/30 bg-success/10">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success">
            {success}
            {showResend ? (
              <button type="button" onClick={handleResendVerification} disabled={isResending} className="mt-1 block font-medium underline underline-offset-2">
                {isResending ? 'Sending…' : 'Resend verification email'}
              </button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}

      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading}>Sign up with Google</GoogleButton>
      <OrDivider />

      <form className="space-y-4" onSubmit={handleEmailSignUp}>
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" type="text" autoComplete="name" value={formData.name} onChange={handleInputChange} className="h-11" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" value={formData.email} onChange={handleInputChange} className="h-11" required placeholder="you@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" value={formData.phone} onChange={handleInputChange} className="h-11" placeholder="+91 98765 43210" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" value={formData.password} onChange={handleInputChange} className="h-11" required minLength={6} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" value={formData.confirmPassword} onChange={handleInputChange} className="h-11" required minLength={6} />
        </div>
        </div>
        <p className="text-xs text-muted-foreground">At least 6 characters. We send a link to confirm your email.</p>
        <Button type="submit" className="h-11 w-full" disabled={isLoading}>
          {isLoading ? <Loader2 className="animate-spin" /> : null}
          {isLoading ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          By signing up you agree to the <Link href="/terms" className="underline">terms</Link> and <Link href="/privacy" className="underline">privacy policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
