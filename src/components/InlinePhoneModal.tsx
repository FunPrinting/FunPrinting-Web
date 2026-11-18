'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PHONE_NOTICE } from '@/components/PhoneNotice';
import { normalisePhoneInput } from '@/lib/phoneValidation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface InlinePhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the saved number, in the format the server stored. */
  onPhoneSaved: (phone: string) => void;
}

/** Asks a signed-in customer for a phone number before they can order. */
export default function InlinePhoneModal({ isOpen, onClose, onPhoneSaved }: InlinePhoneModalProps) {
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPhone('');
      setError('');
    }
  }, [isOpen]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = normalisePhoneInput(phone);
    if (!check.ok) return setError(check.error);
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user/update-phone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: check.phone }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t save your number.');
      onPhoneSaved(data.phone || check.phone);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t save your number. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add your phone number</DialogTitle>
          <DialogDescription>The print shop needs it to reach you about this order.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <div className="space-y-1.5">
            <Label htmlFor="inline-phone">Mobile number</Label>
            <Input id="inline-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => { setPhone(e.target.value); setError(''); }} disabled={saving} autoFocus aria-describedby="inline-phone-hint" />
            <p id="inline-phone-hint" className="text-xs text-muted-foreground">{PHONE_NOTICE}</p>
          </div>
          <Button type="submit" className="h-10" disabled={saving || !phone.trim()}>{saving ? <Loader2 className="animate-spin" /> : null}Save and continue</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
