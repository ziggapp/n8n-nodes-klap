import { describe, expect, it } from 'vitest';

import { accountLabel, postInfoFor, validateTargets } from '../nodes/Klap/shared/schedule';
import { exportFileName, publicSourceUrl, toSocialAccount } from '../nodes/Klap/shared/normalize';
import { isValidTimeZone, parseDateTime } from '../nodes/Klap/shared/time';
import { uploadMimeType } from '../nodes/Klap/shared/upload';
import type { KlapSocialAccount } from '../nodes/Klap/shared/types';

const account = (overrides: Partial<KlapSocialAccount>): KlapSocialAccount => ({
	id: 'a1',
	provider: 'youtube',
	name: 'Acme',
	username: 'acme',
	...overrides,
});

describe('parseDateTime', () => {
	it('uses values with an offset as they are', () => {
		expect(parseDateTime('2026-10-08T09:00:00+02:00', 'UTC')?.toISOString()).toBe(
			'2026-10-08T07:00:00.000Z',
		);
		expect(parseDateTime('2026-10-08T09:00:00Z', 'Europe/Paris')?.toISOString()).toBe(
			'2026-10-08T09:00:00.000Z',
		);
		expect(parseDateTime('2026-10-08T09:00:00.000-0500', 'UTC')?.toISOString()).toBe(
			'2026-10-08T14:00:00.000Z',
		);
	});

	it('reads wall-clock values in the time zone, across daylight saving', () => {
		expect(parseDateTime('2026-10-08T09:00:00', 'UTC')?.toISOString()).toBe(
			'2026-10-08T09:00:00.000Z',
		);
		expect(parseDateTime('2026-10-08T09:00', 'Europe/Paris')?.toISOString()).toBe(
			'2026-10-08T07:00:00.000Z',
		);
		expect(parseDateTime('2026-12-08 09:00:00', 'Europe/Paris')?.toISOString()).toBe(
			'2026-12-08T08:00:00.000Z',
		);
		expect(parseDateTime('2026-07-01T18:30:00', 'America/New_York')?.toISOString()).toBe(
			'2026-07-01T22:30:00.000Z',
		);
		expect(parseDateTime('2026-10-08', 'Asia/Tokyo')?.toISOString()).toBe(
			'2026-10-07T15:00:00.000Z',
		);
	});

	it('rejects what is not a date', () => {
		expect(parseDateTime('tomorrow', 'UTC')).toBeUndefined();
		expect(parseDateTime('', 'UTC')).toBeUndefined();
	});

	it('knows IANA time zones', () => {
		expect(isValidTimeZone('Europe/Paris')).toBe(true);
		expect(isValidTimeZone('Mars/Olympus')).toBe(false);
	});
});

describe('scheduling helpers', () => {
	it('labels accounts like the spec', () => {
		expect(accountLabel(account({ provider: 'tiktok', name: 'Acme', username: 'acme.tt' }))).toBe(
			'TikTok: Acme (@acme.tt)',
		);
		expect(accountLabel(account({ needs_reconnect: true }))).toBe(
			'YouTube: Acme (@acme) — needs reconnecting in Klap',
		);
	});

	it('defaults the YouTube title to the caption, cut at 100 characters', () => {
		const caption = 'x'.repeat(150);
		expect(postInfoFor('youtube', { caption }).title).toHaveLength(100);
		expect(postInfoFor('youtube', { caption, youtubeTitle: 'Short title' }).title).toBe(
			'Short title',
		);
	});

	it('validates the target accounts', () => {
		expect(validateTargets([account({ provider: 'tiktok' })], undefined)).toBe(
			'Choose who can see the TikTok post in TikTok Privacy.',
		);
		expect(validateTargets([account({ provider: 'tiktok' })], 'SELF_ONLY')).toBeUndefined();
		expect(validateTargets([account({ id: 'a' }), account({ id: 'b' })], undefined)).toContain(
			'one YouTube account at a time',
		);
		expect(
			validateTargets([account({}), account({ id: 'i', provider: 'instagram' })], undefined),
		).toBeUndefined();
	});
});

describe('normalization', () => {
	it('hides signed upload URLs', () => {
		expect(
			publicSourceUrl(
				'https://storage.googleapis.com/b/f.mp4?X-Goog-Algorithm=GOOG4&X-Goog-Signature=abc',
			),
		).toBeNull();
		expect(publicSourceUrl('https://www.youtube.com/watch?v=x')).toBe(
			'https://www.youtube.com/watch?v=x',
		);
		expect(publicSourceUrl(null)).toBeNull();
	});

	it('names export files like Klap does', () => {
		expect(exportFileName('Why most startups fail?')).toBe('Why_most_startups_fail_.mp4');
		expect(exportFileName(null)).toBe('clip.mp4');
	});

	it('keeps social accounts to the public fields', () => {
		expect(
			toSocialAccount({
				...account({}),
				profile_picture: '',
				settings: { secret: 1 },
			} as KlapSocialAccount),
		).toEqual({
			id: 'a1',
			provider: 'youtube',
			name: 'Acme',
			username: 'acme',
			profile_picture: null,
			needs_reconnect: false,
		});
	});

	it('detects upload types from the MIME type or the extension', () => {
		expect(uploadMimeType({ mimeType: 'video/mp4' })).toBe('video/mp4');
		expect(uploadMimeType({ mimeType: 'video/x-m4v' })).toBe('video/mp4');
		expect(uploadMimeType({ mimeType: 'application/octet-stream', fileName: 'Clip.MOV' })).toBe(
			'video/quicktime',
		);
		expect(uploadMimeType({ mimeType: 'video/webm; codecs=vp9' })).toBe('video/webm');
		expect(uploadMimeType({ mimeType: 'video/x-matroska', fileName: 'a.mkv' })).toBeUndefined();
	});
});
