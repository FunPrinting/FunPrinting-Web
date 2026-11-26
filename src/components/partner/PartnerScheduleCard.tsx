'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Clock, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  DEFAULT_PICKUP_POINT_SLOTS,
  DEFAULT_STORE_SLOTS,
  formatSlotWindow,
  type ScheduleSlotTemplate,
  type ScheduleTarget,
} from '@/lib/scheduling';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface PartnerLike {
  scheduleSlots?: ScheduleSlotTemplate[];
  deliveryPoints?: Array<{ name: string; isActive?: boolean }>;
}

function initialSlotsForPartner(partner: PartnerLike): ScheduleSlotTemplate[] {
  const saved = partner.scheduleSlots || [];
  const hasStore = saved.some((s) => s.target === 'store');
  const hasPoints = saved.some((s) => s.target === 'pickup_point');
  return [
    ...(hasStore ? saved.filter((s) => s.target === 'store') : DEFAULT_STORE_SLOTS),
    ...(hasPoints ? saved.filter((s) => s.target === 'pickup_point') : DEFAULT_PICKUP_POINT_SLOTS),
  ];
}

export function PartnerScheduleCard({
  partner,
  onSaveSlots,
}: {
  partner: PartnerLike;
  onSaveSlots: (slots: ScheduleSlotTemplate[]) => Promise<void>;
}) {
  const [slots, setSlots] = useState<ScheduleSlotTemplate[]>(() => initialSlotsForPartner(partner));
  const [saving, setSaving] = useState(false);

  const [newTarget, setNewTarget] = useState<ScheduleTarget>('store');
  const [newPointName, setNewPointName] = useState<string>('*');
  const [newStart, setNewStart] = useState('10:00');
  const [newEnd, setNewEnd] = useState('12:00');
  const [newLabel, setNewLabel] = useState('');
  const [newMaxOrders, setNewMaxOrders] = useState('');

  const points = (partner.deliveryPoints || []).filter((p) => p.isActive !== false);

  const addSlot = () => {
    if (!newStart || !newEnd || newEnd <= newStart) {
      return toast.error('End time must be after start time.');
    }
    const id = `${newTarget === 'store' ? 'store' : 'point'}-${Date.now().toString(36)}`;
    const parsedMax = newMaxOrders.trim() ? Math.max(0, Math.min(500, parseInt(newMaxOrders, 10) || 0)) : undefined;
    const item: ScheduleSlotTemplate = {
      id,
      target: newTarget,
      ...(newTarget === 'pickup_point' ? { pickupPointName: newPointName || '*' } : {}),
      ...(newLabel.trim() ? { label: newLabel.trim() } : {}),
      startTime: newStart,
      endTime: newEnd,
      ...(parsedMax ? { maxOrders: parsedMax } : {}),
      cutoffMinutes: 30,
      isActive: true,
    };
    setSlots((prev) => [...prev, item]);
    setNewLabel('');
    setNewMaxOrders('');
  };

  const toggleSlot = (id: string, isActive: boolean) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, isActive } : s)));
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const resetDefaults = () => {
    setSlots([...DEFAULT_STORE_SLOTS, ...DEFAULT_PICKUP_POINT_SLOTS]);
  };

  const save = async () => {
    if (!slots.some((s) => s.target === 'store' && s.isActive)) {
      return toast.error('Keep at least one active Store pickup time slot.');
    }
    if (points.length > 0 && !slots.some((s) => s.target === 'pickup_point' && s.isActive)) {
      return toast.error('Keep at least one active Pickup Point time slot.');
    }
    setSaving(true);
    try {
      await onSaveSlots(slots);
      toast.success('Pickup time slots saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save time slots');
    } finally {
      setSaving(false);
    }
  };

  const renderGroup = (title: string, hint: string, items: ScheduleSlotTemplate[]) => (
    <div className="space-y-2.5">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">No slots configured.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{formatSlotWindow(s.startTime, s.endTime, s.label)}</p>
                <p className="text-xs text-muted-foreground">
                  {s.target === 'pickup_point'
                    ? s.pickupPointName && s.pickupPointName !== '*'
                      ? `Point: ${s.pickupPointName}`
                      : 'All pickup points'
                    : 'Main shop counter'}
                  {s.maxOrders ? ` · Max ${s.maxOrders} orders/day` : ' · Unlimited'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={s.isActive !== false}
                  onCheckedChange={(v) => toggleSlot(s.id, v)}
                  aria-label={`Toggle ${s.startTime} to ${s.endTime}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSlot(s.id)}
                  aria-label="Remove slot"
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const storeSlots = slots.filter((s) => s.target === 'store');
  const pointSlots = slots.filter((s) => s.target === 'pickup_point');

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-5 text-primary" aria-hidden />
            Pickup time slots
          </CardTitle>
          <CardDescription>
            Customers choose a date & time slot at checkout. Store orders allow same-day slots; pickup points start from tomorrow.
          </CardDescription>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={resetDefaults} title="Reset to default slots">
          <RotateCcw className="size-4" />
          Defaults
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {renderGroup('Main shop slots (Same-day & upcoming days)', 'Customers picking up directly at your shop can book today or future days.', storeSlots)}
        {renderGroup('Pickup point slots (Next day onwards)', 'Printed batches are brought to pickup points starting the next day.', pointSlots)}

        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-medium">Add a new time slot</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Location type</Label>
              <Select value={newTarget} onValueChange={(v) => setNewTarget(v as ScheduleTarget)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="store">Main shop (Same-day+)</SelectItem>
                  <SelectItem value="pickup_point">Pickup point (Next-day+)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newTarget === 'pickup_point' ? (
              <div className="space-y-1.5">
                <Label>Pickup point</Label>
                <Select value={newPointName} onValueChange={setNewPointName}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="*">All pickup points</SelectItem>
                    {points.map((pt) => (
                      <SelectItem key={pt.name} value={pt.name}>{pt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="slot-start">Start time</Label>
              <Input id="slot-start" type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot-end">End time</Label>
              <Input id="slot-end" type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot-label">Label (optional)</Label>
              <Input id="slot-label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Lunch Break" maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot-cap">Max orders/day (optional)</Label>
              <Input id="slot-cap" type="number" min={0} max={500} value={newMaxOrders} onChange={(e) => setNewMaxOrders(e.target.value)} placeholder="Unlimited" />
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addSlot}>
            <Plus className="size-4" />
            Add slot
          </Button>
        </div>
      </CardContent>

      <CardFooter className="border-t pt-6">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save time slots
        </Button>
      </CardFooter>
    </Card>
  );
}
