'use client';

import { useId, useState } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
import { PASSWORD_RULES } from '@/lib/passwordRules';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * New password + confirmation with the live rule checklist. `onSubmit` resolves to an
 * error message to show, or null when it worked (the page then navigates away).
 */
export function NewPasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (password: string, confirmPassword: string) => Promise<string | null> }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rules = useId();
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = PASSWORD_RULES.every((r) => r.test(password)) && password === confirm;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError('');
        const problem = await onSubmit(password, confirm).catch(() => 'Something went wrong. Please try again.');
        if (problem) {
          setError(problem);
          setBusy(false);
        }
      }}
    >
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" className="h-11" required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={rules} />
      </div>
      <ul id={rules} className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(password);
          return (
            <li key={r.id} className={cn('flex items-center gap-2', ok ? 'text-success' : 'text-muted-foreground')}>
              {ok ? <Check className="size-4" aria-hidden /> : <Circle className="size-4" aria-hidden />}
              {r.label}
              <span className="sr-only">{ok ? ' (done)' : ' (not yet)'}</span>
            </li>
          );
        })}
      </ul>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" className="h-11" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} aria-describedby={mismatch ? 'confirm-error' : undefined} />
        {mismatch ? <p id="confirm-error" className="text-sm text-destructive">Passwords do not match</p> : null}
      </div>
      <Button type="submit" className="h-11 w-full" disabled={busy || !valid}>
        {busy ? <Loader2 className="animate-spin" /> : null}{submitLabel}
      </Button>
    </form>
  );
}
