export const CREDENTIAL_TYPE = 'klapOAuth2Api';

export const API_URL = 'https://api.klap.app';
export const WEB_URL = 'https://klap.app';
export const BILLING_URL = `${WEB_URL}/billing`;
export const PRICING_URL = `${WEB_URL}/pricing`;
export const CALENDAR_URL = `${WEB_URL}/calendar`;

/** GET /tasks accepts 1–50. */
export const MAX_PROJECTS_PER_PAGE = 50;

/** Video types Klap's upload route accepts. */
export const UPLOAD_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

/** "Post now" leaves Klap's publisher a couple of minutes to pick the post up. */
export const POST_NOW_DELAY_MS = 2 * 60 * 1000;

export const EXPORT_POLL_INTERVAL_MS = 5000;
export const DEFAULT_EXPORT_TIMEOUT_MINUTES = 10;

/** Requests that can take a while: video validation on create, the blocking download. */
export const CREATE_TIMEOUT_MS = 120 * 1000;
export const DOWNLOAD_TIMEOUT_MS = 11 * 60 * 1000;
export const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;

export const MAX_CAPTION_LENGTH = 2200;
export const MAX_YOUTUBE_TITLE_LENGTH = 100;
export const MAX_INSTRUCTIONS_LENGTH = 1000;

export const TIKTOK_PRIVACY_LEVELS = [
	'PUBLIC_TO_EVERYONE',
	'MUTUAL_FOLLOW_FRIENDS',
	'FOLLOWER_OF_CREATOR',
	'SELF_ONLY',
] as const;

export const PROVIDER_LABELS: Record<string, string> = {
	youtube: 'YouTube',
	tiktok: 'TikTok',
	instagram: 'Instagram',
	linkedin: 'LinkedIn',
	facebook: 'Facebook',
};
