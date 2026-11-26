'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, Loader2 } from 'lucide-react';
import type { PartnerCodConfig } from '@/lib/cod';
import { DEFAULT_COD_MAX_AMOUNT, MAX_COD_CAP, MAX_COD_FEE, MIN_COD_MAX_AMOUNT } from '@/lib/cod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function PartnerCodCard({
  partner,
  onSaveCod,
}: {
  partner: { cod?: Partial<PartnerCodConfig> };
  onSaveCod: (cod: PartnerCodConfig) => Promise<void>;
}) {
  const initial = partner.cod;
  const [enabled, setEnabled] = useState(Boolean(initial?.enabled));
  const [allowAtPickupPoints, setAllowAtPickupPoints] = useState(Boolean(initial?.allowAtPickupPoints));
  const [maxOrderAmount, setMaxOrderAmount] = useState(String(initial?.maxOrderAmount ?? DEFAULT_COD_MAX_AMOUNT));
  const [cashFee, setCashFee] = useState(String(initial?.cashFee ?? 0));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const cap = Math.round(Number(maxOrderAmount));
    const fee = Math.round(Number(cashFee));
    if (!Number.isFinite(cap) || cap < MIN_COD_MAX_AMOUNT || cap > MAX_COD_CAP) {
      return toast.error(`Max COD order amount must be between ₹${MIN_COD_MAX_AMOUNT} and ₹${MAX_COD_CAP}`);
    }
    if (!Number.isFinite(fee) || fee < 0 || fee > MAX_COD_FEE) {
      return toast.error(`Cash handling fee must be between ₹0 and ₹${MAX_COD_FEE}`);
    }
    setSaving(true);
    try {
      await onSaveCod({
        enabled,
        allowAtPickupPoints,
        maxOrderAmount: cap,
        cashFee: fee,
      });
      toast.success('Cash on Pickup settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save COD settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="size-5 text-primary" aria-hidden />
          Cash on Pickup (COD)
        </CardTitle>
        <CardDescription>
          All online payments run through Razorpay. Turn on Cash on Pickup for cash-only customers; COD orders require your approval in chat before printing and QR handover verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="cod-enabled">Accept Cash on Pickup (COD)</Label>
            <p className="text-sm text-muted-foreground">
              COD orders never enter the automatic print queue until you confirm with the customer in chat and tap Approve &amp; Print.
            </p>
          </div>
          <Switch id="cod-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled ? (
          <>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3.5">
              <div className="space-y-1">
                <Label htmlFor="cod-points">Allow COD at external pickup points</Label>
                <p className="text-xs text-muted-foreground">
                  Off by default: external pickup points carry higher no-show risk since bundles must be transported. Turn on only if you approve COD there via chat.
                </p>
              </div>
              <Switch id="cod-points" checked={allowAtPickupPoints} onCheckedChange={setAllowAtPickupPoints} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cod-cap">Max COD order amount (₹)</Label>
                <Input
                  id="cod-cap"
                  type="number"
                  inputMode="numeric"
                  min={MIN_COD_MAX_AMOUNT}
                  max={MAX_COD_CAP}
                  value={maxOrderAmount}
                  onChange={(e) => setMaxOrderAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Orders above this limit must pay online via Razorpay.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cod-fee">Optional cash handling fee (₹)</Label>
                <Input
                  id="cod-fee"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_COD_FEE}
                  value={cashFee}
                  onChange={(e) => setCashFee(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Keep ₹0 or add ₹5–₹10 to protect margins on small cash orders.</p>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
      <CardFooter className="border-t pt-6">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save COD settings
        </Button>
      </CardFooter>
    </Card>
  );
}

