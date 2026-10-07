import { PROVIDER_LABELS } from './constants';
import type { KlapSocialAccount, KlapSocialProvider } from './types';

export type PostInfoOptions = {
	caption: string;
	youtubeTitle?: string;
	tiktokPrivacyLevel?: string;
};

/**
 * `post_info` for one publication. Mirrors `postInfoFor` in klap-api's MCP
 * tools (itself the web's PublicationHelper defaults), plus the YouTube title.
 */
export function postInfoFor(provider: KlapSocialProvider, options: PostInfoOptions) {
	const { caption } = options;
	switch (provider) {
		case 'youtube':
			return {
				title: options.youtubeTitle || caption.slice(0, 100),
				description: caption,
				tags: [],
				visibility: 'public',
				category_id: '22',
			};
		case 'tiktok':
			return {
				title: caption,
				privacy_level: options.tiktokPrivacyLevel,
				disable_duet: false,
				disable_stitch: false,
				disable_comment: false,
				video_cover_timestamp_ms: 0,
				brand_content_toggle: false,
				brand_organic_toggle: false,
				is_aigc: false,
			};
		case 'instagram':
			return { caption, share_to_feed: true };
		case 'facebook':
			return { caption };
		case 'linkedin':
			return {
				share_commentary: caption,
				media_title: '',
				media_description: '',
				visibility: 'PUBLIC',
			};
	}
}

export const providerLabel = (provider: string) => PROVIDER_LABELS[provider] ?? provider;

/** Dropdown label: "YouTube: Acme (@acme)", flagged when the account needs reconnecting. */
export function accountLabel(account: KlapSocialAccount): string {
	const username = account.username ? ` (@${account.username})` : '';
	const reconnect = account.needs_reconnect ? ' — needs reconnecting in Klap' : '';
	return `${providerLabel(account.provider)}: ${account.name}${username}${reconnect}`;
}

/**
 * Why these accounts can't be posted to in one go, or undefined when they can.
 * Klap allows one post per (clip, platform), and TikTok needs a privacy level.
 */
export function validateTargets(
	targets: KlapSocialAccount[],
	tiktokPrivacyLevel: string | undefined,
): string | undefined {
	const seen = new Set<string>();
	for (const account of targets) {
		if (seen.has(account.provider)) {
			const label = providerLabel(account.provider);
			return `A clip can be posted to one ${label} account at a time. Choose a single ${label} account.`;
		}
		seen.add(account.provider);
	}
	if (seen.has('tiktok') && !tiktokPrivacyLevel) {
		return 'Choose who can see the TikTok post in TikTok Privacy.';
	}
	return undefined;
}
