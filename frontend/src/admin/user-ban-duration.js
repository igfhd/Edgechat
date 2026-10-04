export const BAN_DURATION_PRESETS = Object.freeze([
  { value: 'one-hour', minutes: 60, label: '1 小时' },
  { value: 'eight-hours', minutes: 8 * 60, label: '8 小时' },
  { value: 'one-day', minutes: 24 * 60, label: '1 天' },
  { value: 'seven-days', minutes: 7 * 24 * 60, label: '7 天' }
]);

export const BAN_UNIT_MINUTES = Object.freeze({
  minutes: 1,
  hours: 60,
  days: 24 * 60
});

export function resolveBanDurationMinutes({ selection, customDuration, customUnit }) {
  if (selection === 'permanent') return null;

  if (selection === 'custom') {
    const durationMinutes = Number(customDuration) * BAN_UNIT_MINUTES[customUnit];
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      throw new RangeError('invalid_ban_duration');
    }
    return durationMinutes;
  }

  const preset = BAN_DURATION_PRESETS.find((option) => option.value === selection);
  if (!preset) throw new RangeError('invalid_ban_duration');
  return preset.minutes;
}

export function banExpiryDate(durationMinutes, now = Date.now()) {
  return new Date(now + durationMinutes * 60 * 1000);
}

export function formatShortDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${M}-${D} ${h}:${m}`;
}
