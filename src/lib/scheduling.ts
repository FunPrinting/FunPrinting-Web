import { z } from 'zod';

export type ScheduleTarget = 'store' | 'pickup_point';

export interface ScheduleSlotTemplate {
  id: string;
  target: ScheduleTarget;
  /** For target='pickup_point': exact pickup point name, or '*' / empty for all pickup points. */
  pickupPointName?: string;
  label?: string;
  /** 24-hour "HH:MM" in IST (Asia/Kolkata), e.g. "10:00". */
  startTime: string;
  /** 24-hour "HH:MM" in IST (Asia/Kolkata), e.g. "12:00". */
  endTime: string;
  /** 0 = Sun .. 6 = Sat; empty/undefined = every day. */
  daysOfWeek?: number[];
  /** Optional cap per day+slot; 0 or undefined = unlimited. */
  maxOrders?: number;
  /** Minutes before slot end (for store) or start when same-day booking closes. Default 30. */
  cutoffMinutes?: number;
  isActive: boolean;
}

export interface ScheduledSlotSelection {
  date: string; // "YYYY-MM-DD" (IST)
  slotId: string;
  label: string;
  startTime: string;
  endTime: string;
  target: ScheduleTarget;
}

export interface SlotAvailability {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  target: ScheduleTarget;
  maxOrders: number | null;
  bookedCount: number;
  remaining: number | null;
  isFull: boolean;
}

export interface DayAvailability {
  date: string; // "YYYY-MM-DD"
  weekdayShort: string; // "Thu"
  dayNumber: string; // "26"
  monthShort: string; // "Nov"
  isToday: boolean;
  isTomorrow: boolean;
  slots: SlotAvailability[];
}

export const DEFAULT_STORE_SLOTS: ScheduleSlotTemplate[] = [
  { id: 'store-morning', target: 'store', startTime: '10:00', endTime: '12:00', cutoffMinutes: 30, isActive: true },
  { id: 'store-afternoon', target: 'store', startTime: '12:00', endTime: '15:00', cutoffMinutes: 30, isActive: true },
  { id: 'store-evening', target: 'store', startTime: '15:00', endTime: '18:00', cutoffMinutes: 30, isActive: true },
  { id: 'store-late', target: 'store', startTime: '18:00', endTime: '20:00', cutoffMinutes: 30, isActive: true },
];

export const DEFAULT_PICKUP_POINT_SLOTS: ScheduleSlotTemplate[] = [
  { id: 'point-morning', target: 'pickup_point', pickupPointName: '*', startTime: '10:30', endTime: '11:30', cutoffMinutes: 30, isActive: true },
  { id: 'point-lunch', target: 'pickup_point', pickupPointName: '*', startTime: '13:00', endTime: '14:00', cutoffMinutes: 30, isActive: true },
  { id: 'point-evening', target: 'pickup_point', pickupPointName: '*', startTime: '16:30', endTime: '17:30', cutoffMinutes: 30, isActive: true },
];

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const scheduleSlotSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    target: z.enum(['store', 'pickup_point']),
    pickupPointName: z.string().trim().max(200).optional(),
    label: z.string().trim().max(80).optional(),
    startTime: z.string().regex(TIME_RE, 'Use HH:MM (24-hour) format for start time'),
    endTime: z.string().regex(TIME_RE, 'Use HH:MM (24-hour) format for end time'),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    maxOrders: z.number().int().min(0).max(500).optional(),
    cutoffMinutes: z.number().int().min(0).max(360).optional(),
    isActive: z.boolean(),
  })
  .refine((s) => toMinutes(s.endTime) > toMinutes(s.startTime), {
    message: 'End time must be after start time',
  });

export const scheduleSlotsArraySchema = z.array(scheduleSlotSchema).max(60);

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatSlotWindow(startTime: string, endTime: string, label?: string): string {
  const base = `${formatTime12h(startTime)} – ${formatTime12h(endTime)}`;
  return label?.trim() ? `${base} (${label.trim()})` : base;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Returns current IST calendar fields computed deterministically regardless of host TZ. */
export function getIstParts(now: Date = new Date()): { date: string; minutesOfDay: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const minutesOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date: `${y}-${m}-${d}`, minutesOfDay };
}

export function addDaysIst(baseDate: string, days: number): string {
  const [y, m, d] = baseDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateDisplayParts(dateStr: string): { weekdayShort: string; dayNumber: string; monthShort: string; dayOfWeek: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay();
  return {
    weekdayShort: WEEKDAYS[dayOfWeek],
    dayNumber: String(d),
    monthShort: MONTHS[m - 1],
    dayOfWeek,
  };
}

/**
 * Selects effective slot templates for the target.
 * Uses partner-configured slots for that target if present; otherwise sensible defaults.
 */
export function resolveTemplatesForTarget(
  partnerSlots: ScheduleSlotTemplate[] | undefined | null,
  target: ScheduleTarget,
  pickupPointName?: string
): ScheduleSlotTemplate[] {
  const configuredForTarget = (partnerSlots || []).filter((s) => s.target === target);
  if (configuredForTarget.length === 0) {
    return target === 'store' ? DEFAULT_STORE_SLOTS : DEFAULT_PICKUP_POINT_SLOTS;
  }

  if (target === 'store') {
    return configuredForTarget.filter((s) => s.isActive !== false);
  }

  // For pickup points, prefer point-specific slots if the partner defined any for this exact point;
  // otherwise use wildcard ('*' or unset) pickup-point slots.
  const normalizedPoint = (pickupPointName || '').trim().toLowerCase();
  const pointSpecific = configuredForTarget.filter(
    (s) => s.pickupPointName && s.pickupPointName.trim() !== '*' && s.pickupPointName.trim().toLowerCase() === normalizedPoint
  );
  if (pointSpecific.length > 0) {
    return pointSpecific.filter((s) => s.isActive !== false);
  }
  return configuredForTarget.filter(
    (s) => s.isActive !== false && (!s.pickupPointName || s.pickupPointName.trim() === '' || s.pickupPointName.trim() === '*')
  );
}

/**
 * Builds a 7-day Apple-style availability calendar.
 * - Main store (`target === 'store'`): starts from Today (dayOffset 0), allowing same-day booking.
 * - Pickup point (`target === 'pickup_point'`): starts from Tomorrow (dayOffset 1) — never same-day.
 */
export function buildScheduleCalendar(opts: {
  partnerSlots?: ScheduleSlotTemplate[] | null;
  target: ScheduleTarget;
  pickupPointName?: string;
  bookedCounts?: Record<string, number>; // key: `${date}|${slotId}`
  now?: Date;
  daysCount?: number;
}): DayAvailability[] {
  const { partnerSlots, target, pickupPointName, bookedCounts = {}, now = new Date(), daysCount = 7 } = opts;
  const templates = resolveTemplatesForTarget(partnerSlots, target, pickupPointName)
    .slice()
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  const { date: todayIst, minutesOfDay } = getIstParts(now);
  const startOffset = target === 'pickup_point' ? 1 : 0;

  const days: DayAvailability[] = [];
  for (let i = 0; i < daysCount; i++) {
    const offset = startOffset + i;
    const date = addDaysIst(todayIst, offset);
    const { weekdayShort, dayNumber, monthShort, dayOfWeek } = dateDisplayParts(date);
    const isToday = offset === 0;
    const isTomorrow = offset === 1;

    const slots: SlotAvailability[] = [];
    for (const tpl of templates) {
      if (tpl.daysOfWeek && tpl.daysOfWeek.length > 0 && !tpl.daysOfWeek.includes(dayOfWeek)) {
        continue;
      }
      if (isToday) {
        const cutoff = tpl.cutoffMinutes ?? 30;
        const endMins = toMinutes(tpl.endTime);
        if (minutesOfDay > endMins - cutoff) {
          continue;
        }
      }

      const maxOrders = tpl.maxOrders && tpl.maxOrders > 0 ? tpl.maxOrders : null;
      const bookedCount = bookedCounts[`${date}|${tpl.id}`] ?? 0;
      const remaining = maxOrders !== null ? Math.max(0, maxOrders - bookedCount) : null;
      const isFull = remaining !== null && remaining <= 0;

      slots.push({
        id: tpl.id,
        label: formatSlotWindow(tpl.startTime, tpl.endTime, tpl.label),
        startTime: tpl.startTime,
        endTime: tpl.endTime,
        target,
        maxOrders,
        bookedCount,
        remaining,
        isFull,
      });
    }

    days.push({
      date,
      weekdayShort,
      dayNumber,
      monthShort,
      isToday,
      isTomorrow,
      slots,
    });
  }

  return days;
}

export function validateSlotSelection(opts: {
  partnerSlots?: ScheduleSlotTemplate[] | null;
  target: ScheduleTarget;
  pickupPointName?: string;
  date: string;
  slotId: string;
  bookedCounts?: Record<string, number>;
  now?: Date;
}): { ok: true; slot: SlotAvailability } | { ok: false; error: string } {
  const calendar = buildScheduleCalendar({
    partnerSlots: opts.partnerSlots,
    target: opts.target,
    pickupPointName: opts.pickupPointName,
    bookedCounts: opts.bookedCounts,
    now: opts.now,
    daysCount: 14,
  });

  const day = calendar.find((d) => d.date === opts.date);
  if (!day) {
    return {
      ok: false,
      error:
        opts.target === 'pickup_point'
          ? 'Pickup point orders can only be scheduled starting tomorrow.'
          : 'Please choose an available date within the next 14 days.',
    };
  }

  const slot = day.slots.find((s) => s.id === opts.slotId);
  if (!slot) {
    return { ok: false, error: 'That time slot is no longer available for the selected date. Please pick another time.' };
  }
  if (slot.isFull) {
    return { ok: false, error: 'That time slot is now full. Please select another time.' };
  }
  return { ok: true, slot };
}
