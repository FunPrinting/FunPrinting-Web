import { describe, expect, it } from 'vitest';
import {
  buildScheduleCalendar,
  DEFAULT_STORE_SLOTS,
  getIstParts,
  validateSlotSelection,
  type ScheduleSlotTemplate,
} from '@/lib/scheduling';

describe('scheduling', () => {
  // 2026-11-26 11:00 IST = 2026-11-26T05:30:00Z
  const morningIst = new Date('2026-11-26T05:30:00.000Z');
  // 2026-11-26 21:00 IST = 2026-11-26T15:30:00Z
  const nightIst = new Date('2026-11-26T15:30:00.000Z');

  it('computes IST date and minutes deterministically', () => {
    expect(getIstParts(morningIst)).toEqual({ date: '2026-11-26', minutesOfDay: 11 * 60 });
    expect(getIstParts(nightIst)).toEqual({ date: '2026-11-26', minutesOfDay: 21 * 60 });
  });

  it('allows same-day booking for Main Store starting Today (filtering elapsed slots)', () => {
    const days = buildScheduleCalendar({ target: 'store', now: morningIst, daysCount: 7 });
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-11-26');
    expect(days[0].isToday).toBe(true);
    // All default store slots end >= 12:00 (cutoff 11:30), so at 11:00 IST all 4 are open
    expect(days[0].slots).toHaveLength(DEFAULT_STORE_SLOTS.length);

    // At 21:00 IST, all same-day store slots have closed, while Tomorrow stays open
    const nightDays = buildScheduleCalendar({ target: 'store', now: nightIst, daysCount: 7 });
    expect(nightDays[0].isToday).toBe(true);
    expect(nightDays[0].slots).toHaveLength(0);
    expect(nightDays[1].isTomorrow).toBe(true);
    expect(nightDays[1].slots.length).toBeGreaterThan(0);
  });

  it('enforces next-day onwards for Pickup Points (never same-day)', () => {
    const days = buildScheduleCalendar({
      target: 'pickup_point',
      pickupPointName: 'Graphic era Hill University(let me bake)',
      now: morningIst,
      daysCount: 7,
    });
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-11-27');
    expect(days[0].isToday).toBe(false);
    expect(days[0].isTomorrow).toBe(true);
    expect(days.some((d) => d.date === '2026-11-26')).toBe(false);

    const rejectToday = validateSlotSelection({
      target: 'pickup_point',
      date: '2026-11-26',
      slotId: 'point-morning',
      now: morningIst,
    });
    expect(rejectToday.ok).toBe(false);

    const acceptTomorrow = validateSlotSelection({
      target: 'pickup_point',
      date: '2026-11-27',
      slotId: 'point-morning',
      now: morningIst,
    });
    expect(acceptTomorrow.ok).toBe(true);
  });

  it('prefers point-specific partner slots and enforces maxOrders capacity', () => {
    const custom: ScheduleSlotTemplate[] = [
      { id: 'pt-all', target: 'pickup_point', pickupPointName: '*', startTime: '09:00', endTime: '10:00', isActive: true },
      { id: 'pt-gehu', target: 'pickup_point', pickupPointName: 'Let Me Bake', startTime: '13:00', endTime: '13:30', maxOrders: 2, isActive: true },
    ];

    const gehuDays = buildScheduleCalendar({
      partnerSlots: custom,
      target: 'pickup_point',
      pickupPointName: 'Let Me Bake',
      bookedCounts: { '2026-11-27|pt-gehu': 2 },
      now: morningIst,
    });
    expect(gehuDays[0].slots).toHaveLength(1);
    expect(gehuDays[0].slots[0].id).toBe('pt-gehu');
    expect(gehuDays[0].slots[0].isFull).toBe(true);
    expect(gehuDays[0].slots[0].remaining).toBe(0);

    const fullCheck = validateSlotSelection({
      partnerSlots: custom,
      target: 'pickup_point',
      pickupPointName: 'Let Me Bake',
      date: '2026-11-27',
      slotId: 'pt-gehu',
      bookedCounts: { '2026-11-27|pt-gehu': 2 },
      now: morningIst,
    });
    expect(fullCheck.ok).toBe(false);
  });
});
