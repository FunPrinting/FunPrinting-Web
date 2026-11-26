'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayAvailability, ScheduledSlotSelection, ScheduleTarget } from '@/lib/scheduling';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface SchedulePickerProps {
  partnerId: string;
  target: ScheduleTarget;
  pickupPoint?: string;
  locationLabel: string;
  value: ScheduledSlotSelection | null;
  onChange: (next: ScheduledSlotSelection | null) => void;
}

/**
 * Apple Support–style Day & Time-Slot scheduler:
 * - Main Store (`target === 'store'`): allows same-day slots + upcoming days.
 * - Pickup Point (`target === 'pickup_point'`): starts from tomorrow (next day) onwards.
 */
export function SchedulePicker({
  partnerId,
  target,
  pickupPoint,
  locationLabel,
  value,
  onChange,
}: SchedulePickerProps) {
  const [days, setDays] = useState<DayAvailability[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>(value?.date || '');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ target });
    if (pickupPoint) qs.set('pickupPoint', pickupPoint);

    fetch(`/api/partners/${encodeURIComponent(partnerId)}/slots?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success || !Array.isArray(data.days)) {
          setError(data.error || 'Could not load available slots');
          setDays([]);
          onChangeRef.current(null);
          return;
        }
        const list = data.days as DayAvailability[];
        setDays(list);

        // Preserve current selection if still valid; otherwise auto-pick earliest available day & slot
        const existingDay = value?.date ? list.find((d) => d.date === value.date) : undefined;
        const existingSlot = existingDay?.slots.find((s) => s.id === value?.slotId && !s.isFull);
        if (existingDay && existingSlot) {
          setSelectedDate(existingDay.date);
          return;
        }

        const firstOpenDay = list.find((d) => d.slots.some((s) => !s.isFull));
        const firstOpenSlot = firstOpenDay?.slots.find((s) => !s.isFull);
        if (firstOpenDay && firstOpenSlot) {
          setSelectedDate(firstOpenDay.date);
          onChangeRef.current({
            date: firstOpenDay.date,
            slotId: firstOpenSlot.id,
            label: firstOpenSlot.label,
            startTime: firstOpenSlot.startTime,
            endTime: firstOpenSlot.endTime,
            target,
          });
        } else {
          setSelectedDate(list[0]?.date || '');
          onChangeRef.current(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load available time slots.');
          setDays([]);
          onChangeRef.current(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, target, pickupPoint]);

  const activeDay = days?.find((d) => d.date === selectedDate) ?? days?.[0];

  const handleSelectDay = (day: DayAvailability) => {
    setSelectedDate(day.date);
    const currentSlotOnNewDay = value?.slotId ? day.slots.find((s) => s.id === value.slotId && !s.isFull) : undefined;
    const chosen = currentSlotOnNewDay || day.slots.find((s) => !s.isFull);
    if (chosen) {
      onChange({
        date: day.date,
        slotId: chosen.id,
        label: chosen.label,
        startTime: chosen.startTime,
        endTime: chosen.endTime,
        target,
      });
    } else {
      onChange(null);
    }
  };

  const handleSelectTime = (slotId: string) => {
    if (!activeDay) return;
    const slot = activeDay.slots.find((s) => s.id === slotId && !s.isFull);
    if (!slot) return;
    onChange({
      date: activeDay.date,
      slotId: slot.id,
      label: slot.label,
      startTime: slot.startTime,
      endTime: slot.endTime,
      target,
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-12 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-11 w-full rounded-lg sm:w-72" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!days || days.length === 0) {
    return <p className="text-sm text-muted-foreground">No schedule slots available right now.</p>;
  }

  return (
    <div className="space-y-5">
      {/* Rule badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Calendar className="size-3.5 text-primary" aria-hidden />
          <span>
            {target === 'pickup_point'
              ? `Pickup point runs start tomorrow at ${locationLabel}`
              : `Same-day store pickup available at ${locationLabel}`}
          </span>
        </span>
        <span className={cn('rounded-full px-2 py-0.5 font-medium', target === 'pickup_point' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400')}>
          {target === 'pickup_point' ? 'Next day onwards' : 'Same-day available'}
        </span>
      </div>

      {/* Day strip (Apple Support style) */}
      <div className="space-y-2.5">
        <p className="text-sm font-semibold text-foreground">Day</p>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {days.map((day) => {
            const hasOpen = day.slots.some((s) => !s.isFull);
            const selected = activeDay?.date === day.date;
            return (
              <button
                key={day.date}
                type="button"
                disabled={!hasOpen}
                onClick={() => handleSelectDay(day)}
                aria-pressed={selected}
                aria-label={`${day.weekdayShort} ${day.dayNumber} ${day.monthShort}`}
                className={cn(
                  'group flex shrink-0 flex-col items-center gap-1.5 focus:outline-none',
                  !hasOpen && 'cursor-not-allowed opacity-40'
                )}
              >
                <span className={cn('text-xs font-medium', selected ? 'text-primary font-semibold' : 'text-muted-foreground')}>
                  {day.weekdayShort}
                </span>
                <span
                  className={cn(
                    'grid size-11 place-items-center rounded-full border text-sm font-medium tabular-nums transition-all',
                    selected
                      ? 'border-2 border-primary bg-primary/5 font-semibold text-primary shadow-xs ring-2 ring-primary/15'
                      : hasOpen
                        ? 'border-border bg-background text-foreground group-hover:border-primary/50'
                        : 'border-dashed border-border bg-muted text-muted-foreground'
                  )}
                >
                  {day.dayNumber}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {day.isToday ? 'Today' : day.isTomorrow ? 'Tmrw' : day.monthShort}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Time</p>
            <p className="text-xs text-muted-foreground">Shop’s local time (IST)</p>
          </div>
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>

        {activeDay && activeDay.slots.length > 0 ? (
          <div className="space-y-2.5">
            <Select value={value?.slotId || ''} onValueChange={handleSelectTime}>
              <SelectTrigger className="h-11 w-full sm:max-w-sm">
                <Clock className="size-4 text-muted-foreground" aria-hidden />
                <SelectValue placeholder="Available times" />
              </SelectTrigger>
              <SelectContent>
                {activeDay.slots.map((slot) => (
                  <SelectItem key={slot.id} value={slot.id} disabled={slot.isFull}>
                    <span className="flex items-center gap-2">
                      <span>{slot.label}</span>
                      {slot.isFull ? (
                        <span className="text-xs text-destructive">(Full)</span>
                      ) : slot.remaining !== null && slot.remaining <= 5 ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400">({slot.remaining} left)</span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Quick tap chips for fast mobile selection */}
            <div className="flex flex-wrap gap-2">
              {activeDay.slots.map((slot) => {
                const isSelected = value?.date === activeDay.date && value?.slotId === slot.id;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={slot.isFull}
                    onClick={() => handleSelectTime(slot.id)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      slot.isFull
                        ? 'cursor-not-allowed border-dashed bg-muted/50 text-muted-foreground line-through opacity-60'
                        : isSelected
                          ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                          : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/40'
                    )}
                  >
                    {slot.label}
                    {slot.isFull ? ' · Full' : slot.remaining !== null && slot.remaining <= 5 ? ` · ${slot.remaining} left` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            All time slots for this day have closed. Please pick another day above.
          </p>
        )}
      </div>
    </div>
  );
}
