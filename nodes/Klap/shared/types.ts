/** Shapes as Klap's routes return them. */

export type KlapTaskStatus = 'processing' | 'ready' | 'error' | 'expired';

export type KlapTask = {
	id: string;
	status: KlapTaskStatus;
	error_code: string | null;
	name: string;
	source_url: string | null;
	thumbnail_url: string | null;
	created_at: string;
	estimated_ready_at: string;
	folder_id?: string | null;
	url: string | null;
};

export type KlapClip = {
	id: string;
	name: string;
	virality_score: number | null;
	virality_score_explanation: string | null;
	duration_seconds: number;
	width: number;
	height: number;
	thumbnail_url: string;
	embed_url: string;
	editor_url: string;
	created_at: string;
};

export type KlapExport = {
	id: string;
	status: 'processing' | 'ready' | 'error';
	src_url: string | null;
	estimated_ready_at: string;
	project_id: string;
	created_at: string;
	finished_at: string | null;
	name?: string | null;
};

export type KlapSocialProvider = 'youtube' | 'tiktok' | 'instagram' | 'linkedin' | 'facebook';

export type KlapSocialAccount = {
	id: string;
	provider: KlapSocialProvider;
	name: string;
	username: string;
	profile_picture?: string;
	needs_reconnect?: boolean;
};

export type KlapErrorBody = {
	name?: string;
	message?: string;
	error?: string;
	error_code?: string;
	required_plan?: string;
};

/** Normalized output objects (identical on Zapier, Make and n8n). */

export type ProjectOutput = {
	id: string;
	name: string;
	status: KlapTaskStatus;
	error_code: string | null;
	error_message: string | null;
	source_url: string | null;
	thumbnail_url: string | null;
	created_at: string;
	estimated_ready_at: string;
	url: string | null;
	clip_count?: number;
	clips?: ClipOutput[];
};

export type ClipOutput = {
	id: string;
	name: string;
	virality_score: number | null;
	virality_score_explanation: string | null;
	duration_seconds: number;
	width: number;
	height: number;
	thumbnail_url: string;
	preview_url: string;
	editor_url: string;
	created_at: string;
	rank: number;
	project_id: string | null;
	project_name: string | null;
	project_url: string | null;
};

export type ExportOutput = {
	id: string;
	clip_id: string;
	status: 'processing' | 'ready' | 'error';
	video_url: string | null;
	file_name: string;
	estimated_ready_at: string;
	created_at: string;
	finished_at: string | null;
};

export type ScheduledPostOutput = {
	id: string;
	clip_id: string;
	account_id: string;
	provider: KlapSocialProvider;
	account_name: string;
	scheduled_at: string;
	status: string;
	calendar_url: string;
};

export type SocialAccountOutput = {
	id: string;
	provider: KlapSocialProvider;
	name: string;
	username: string;
	profile_picture: string | null;
	needs_reconnect: boolean;
};
