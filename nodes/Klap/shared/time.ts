/** Whether `timeZone` is an IANA time zone the runtime knows (e.g. Europe/Paris). */
export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
		return true;
	} catch {
		return false;
	}
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function timeZoneOffsetMs(instant: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(instant);
	const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second'),
	);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

const WALL_CLOCK =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parses a date-time from a node parameter. Values with an offset (or `Z`) are
 * used as is; wall-clock values (what n8n's date picker produces) are read in
 * `timeZone`. Returns undefined when the value isn't a date.
 */
export function parseDateTime(value: string, timeZone: string): Date | undefined {
	const text = value.trim();
	if (!text) return undefined;

	if (HAS_OFFSET.test(text)) {
		const instant = Date.parse(text);
		return Number.isNaN(instant) ? undefined : new Date(instant);
	}

	const match = WALL_CLOCK.exec(text);
	if (!match) return undefined;
	const [, year, month, day, hour = '0', minute = '0', second = '0', millis = '0'] = match;
	const wallClockAsUtc = Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
		Number(millis.padEnd(3, '0')),
	);
	if (Number.isNaN(wallClockAsUtc)) return undefined;

	// The offset depends on the instant (daylight saving), so settle it in two passes.
	let instant = wallClockAsUtc - timeZoneOffsetMs(wallClockAsUtc, timeZone);
	instant = wallClockAsUtc - timeZoneOffsetMs(instant, timeZone);
	return new Date(instant);
}
