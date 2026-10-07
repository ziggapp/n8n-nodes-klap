import type {
	ClipOutput,
	ExportOutput,
	KlapClip,
	KlapExport,
	KlapSocialAccount,
	KlapTask,
	ProjectOutput,
	SocialAccountOutput,
} from './types';

/** Why a project ended with `status=error`, as users read it. */
const PROJECT_ERROR_MESSAGES: Record<string, string> = {
	no_clip_generated: "Klap couldn't find clip-worthy moments in this video.",
	not_enough_tokens: "The video doesn't have enough speech to find clips.",
	no_speech_detected: "The video doesn't have enough speech to find clips.",
	video_private: 'The YouTube video is private.',
	video_members_only: 'The YouTube video is members-only.',
	video_removed: 'The YouTube video was removed.',
	video_age_restricted: 'The YouTube video is age-restricted.',
	external_download_failed: "Klap couldn't download the video.",
};

export function projectErrorMessage(errorCode: string | null | undefined): string {
	if (!errorCode) return "Klap couldn't process this video.";
	return PROJECT_ERROR_MESSAGES[errorCode] ?? `Klap couldn't process this video (${errorCode}).`;
}

/**
 * An upload's source is a signed Cloud Storage URL to the raw file, not a link
 * the user gave, so it isn't passed on.
 */
export function publicSourceUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).searchParams.has('X-Goog-Signature') ? null : url;
	} catch {
		return null;
	}
}

/** The download file name Klap uses: the clip name with unsafe characters replaced. */
export function exportFileName(name: string | null | undefined): string {
	const base = (name ?? '').trim() || 'clip';
	return `${base.replace(/[^a-zA-Z0-9._-]/g, '_')}.mp4`;
}

export function toProject(task: KlapTask, clips?: KlapClip[]): ProjectOutput {
	const project: ProjectOutput = {
		id: task.id,
		name: task.name,
		status: task.status,
		error_code: task.error_code ?? null,
		error_message: task.status === 'error' ? projectErrorMessage(task.error_code) : null,
		source_url: publicSourceUrl(task.source_url),
		thumbnail_url: task.thumbnail_url ?? null,
		created_at: task.created_at,
		estimated_ready_at: task.estimated_ready_at,
		url: task.url ?? null,
	};
	if (clips) {
		project.clip_count = clips.length;
		project.clips = toClips(clips, task);
	}
	return project;
}

/** Clips as GET /tasks/{id}/clips returns them: best first, so the index is the rank. */
export function toClips(clips: KlapClip[], task?: KlapTask): ClipOutput[] {
	return clips.map((clip, index) => toClip(clip, index + 1, task));
}

export function toClip(clip: KlapClip, rank: number, task?: KlapTask): ClipOutput {
	return {
		id: clip.id,
		name: clip.name,
		virality_score: clip.virality_score ?? null,
		virality_score_explanation: clip.virality_score_explanation ?? null,
		duration_seconds: clip.duration_seconds,
		width: clip.width,
		height: clip.height,
		thumbnail_url: clip.thumbnail_url,
		preview_url: clip.embed_url,
		editor_url: clip.editor_url,
		created_at: clip.created_at,
		rank,
		project_id: task?.id ?? null,
		project_name: task?.name ?? null,
		project_url: task?.url ?? null,
	};
}

export function toExport(record: KlapExport, clipId: string): ExportOutput {
	return {
		id: record.id,
		clip_id: record.project_id ?? clipId,
		status: record.status,
		video_url: record.status === 'ready' ? (record.src_url ?? null) : null,
		file_name: exportFileName(record.name),
		estimated_ready_at: record.estimated_ready_at,
		created_at: record.created_at,
		finished_at: record.finished_at ?? null,
	};
}

export function toSocialAccount(account: KlapSocialAccount): SocialAccountOutput {
	return {
		id: account.id,
		provider: account.provider,
		name: account.name,
		username: account.username,
		profile_picture: account.profile_picture || null,
		needs_reconnect: account.needs_reconnect === true,
	};
}
