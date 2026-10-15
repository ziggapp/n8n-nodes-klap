import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import {
	CLIPS_POLL_INTERVAL_MS,
	CLIPS_WAIT_TICK_MS,
	CREATE_TIMEOUT_MS,
	DEFAULT_CLIPS_TIMEOUT_MINUTES,
	MAX_INSTRUCTIONS_LENGTH,
	MAX_PROJECTS_PER_PAGE,
	WEB_URL,
} from '../shared/constants';
import { toClips, toProject } from '../shared/normalize';
import { klapRequest, segment } from '../shared/transport';
import type { KlapClip, KlapTask } from '../shared/types';
import { uploadBinaryVideo } from '../shared/upload';

const DIMENSIONS: Record<string, { width: number; height: number }> = {
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
	'4:5': { width: 1080, height: 1350 },
	'16:9': { width: 1920, height: 1080 },
};

export type CreateFields = {
	aspectRatio?: string;
	clipLength?: string;
	instructions?: string;
	language?: string;
	maxClipCount?: number;
	projectName?: string;
};

/** Body of POST /tasks/video-to-shorts: only what the user set. */
export function buildCreateBody(
	sourceUrl: string,
	fields: CreateFields,
	name?: string,
): IDataObject {
	const body: IDataObject = { source_video_url: sourceUrl };
	if (name) body.name = name;
	if (fields.maxClipCount !== undefined && fields.maxClipCount !== null) {
		body.max_clip_count = fields.maxClipCount;
	}
	const target = Number(fields.clipLength);
	// '0' (or empty) is Auto: Klap's default, about 60 seconds.
	if (Number.isFinite(target) && target > 0) {
		body.target_duration = target;
		body.min_duration = Math.min(20, target);
	}
	if (fields.language) body.language = fields.language.trim().toLowerCase();
	if (fields.instructions?.trim()) body.curation_prompt = fields.instructions.trim();
	if (fields.aspectRatio && DIMENSIONS[fields.aspectRatio]) {
		body.dimensions = DIMENSIONS[fields.aspectRatio];
	}
	return body;
}

/** The raw task row POST /tasks/video-to-shorts answers with. */
type CreatedTask = {
	id: string;
	status?: KlapTask['status'];
	error_code?: string | null;
	src_name?: string;
	src_url?: string;
	created_at?: string;
	estimated_time_seconds?: number;
	output_type?: string;
	output_id?: string | null;
};

/** Summary shape from the raw row, for when the follow-up GET fails (never re-create: it bills twice). */
function taskFromCreated(created: CreatedTask): KlapTask {
	const createdAt = created.created_at ?? new Date().toISOString();
	const estimatedSeconds = created.estimated_time_seconds ?? 0;
	return {
		id: created.id,
		status: created.status ?? 'processing',
		error_code: created.error_code ?? null,
		name: created.src_name ?? '',
		source_url: created.src_url ?? null,
		thumbnail_url: null,
		created_at: createdAt,
		estimated_ready_at: new Date(Date.parse(createdAt) + estimatedSeconds * 1000).toISOString(),
		url:
			created.output_type === 'folder' && created.output_id
				? `${WEB_URL}/spaces/${created.output_id}`
				: null,
	};
}

function isHttpUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

export async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const source = this.getNodeParameter('source', i) as 'url' | 'binary';
	const fields = this.getNodeParameter('additionalFields', i, {}) as CreateFields;

	if ((fields.instructions ?? '').trim().length > MAX_INSTRUCTIONS_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`Instructions can be up to ${MAX_INSTRUCTIONS_LENGTH} characters. Shorten them and try again.`,
			{ itemIndex: i },
		);
	}

	let name = fields.projectName?.trim() || undefined;
	let sourceUrl: string;
	if (source === 'binary') {
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const upload = await uploadBinaryVideo.call(this, i, binaryPropertyName);
		sourceUrl = upload.sourceUrl;
		// Like klap.app, name an uploaded file's project after the file.
		name = name ?? upload.fileName?.slice(0, 200);
	} else {
		sourceUrl = (this.getNodeParameter('videoUrl', i) as string).trim();
		if (!isHttpUrl(sourceUrl)) {
			throw new NodeOperationError(
				this.getNode(),
				'Video URL must be a link to the video, starting with https://',
				{
					itemIndex: i,
					description:
						'For example https://www.youtube.com/watch?v=dQw4w9WgXcQ, a Google Drive or Dropbox share link, or a direct link to a video file.',
				},
			);
		}
	}

	const created = await klapRequest<CreatedTask>(this, 'POST', '/tasks/video-to-shorts', {
		body: buildCreateBody(sourceUrl, fields, name),
		itemIndex: i,
		timeout: CREATE_TIMEOUT_MS,
	});

	let task: KlapTask;
	try {
		task = await klapRequest<KlapTask>(this, 'GET', `/tasks/${segment(created.id)}`, {
			itemIndex: i,
		});
	} catch {
		task = taskFromCreated(created);
	}

	// On by default from node version 1.1; version 1 returned the project right away.
	const wait = this.getNodeParameter(
		'waitForClips',
		i,
		this.getNode().typeVersion >= 1.1,
	) as boolean;
	if (!wait) return [{ json: toProject(task) }];
	return await waitForClips.call(this, i, task);
}

/** Polls the project until Klap is done, then returns one item per clip, best first. */
async function waitForClips(
	this: IExecuteFunctions,
	i: number,
	created: KlapTask,
): Promise<INodeExecutionData[]> {
	const timeoutMinutes = this.getNodeParameter(
		'waitTimeoutMinutes',
		i,
		DEFAULT_CLIPS_TIMEOUT_MINUTES,
	) as number;
	const deadline = Date.now() + timeoutMinutes * 60 * 1000;
	const cancelSignal = this.getExecutionCancelSignal?.();
	const what = `project ${created.id}`;
	const projectPath = `/tasks/${segment(created.id)}`;

	let task = created;
	let nextCheck = Date.now() + CLIPS_POLL_INTERVAL_MS;
	while (task.status === 'processing') {
		if (cancelSignal?.aborted) {
			throw new NodeOperationError(this.getNode(), 'The execution was canceled', {
				itemIndex: i,
			});
		}
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`Klap is still clipping this video after ${timeoutMinutes} minute${timeoutMinutes === 1 ? '' : 's'}`,
				{
					itemIndex: i,
					description: `The project keeps going in Klap${task.url ? ` (${task.url})` : ''}. Get its clips later with Project → Get (project ID ${task.id}) or the Klap Trigger, or raise Timeout (Minutes).`,
				},
			);
		}
		await sleep(CLIPS_WAIT_TICK_MS);
		if (Date.now() < nextCheck) continue;
		nextCheck = Date.now() + CLIPS_POLL_INTERVAL_MS;
		task = await klapRequest<KlapTask>(this, 'GET', projectPath, { itemIndex: i, what });
	}

	if (task.status !== 'ready') {
		const project = toProject(task);
		throw new NodeOperationError(
			this.getNode(),
			project.error_message ?? `Klap couldn't clip this video (status: ${task.status})`,
			{ itemIndex: i, description: `Project ID ${task.id}` },
		);
	}

	const clips = await klapRequest<KlapClip[]>(this, 'GET', `${projectPath}/clips`, {
		itemIndex: i,
		what,
	});
	if (clips.length === 0) {
		throw new NodeOperationError(this.getNode(), "Klap didn't find any clips in this video", {
			itemIndex: i,
			description: `Project ID ${task.id}. Try another video, or change the clip length or instructions.`,
		});
	}
	return toClips(clips, task).map((clip) => ({ json: clip }));
}

export async function get(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const projectId = this.getNodeParameter('projectId', i, '', { extractValue: true }) as string;
	const what = `project ${projectId}`;
	const task = await klapRequest<KlapTask>(this, 'GET', `/tasks/${segment(projectId)}`, {
		itemIndex: i,
		what,
	});
	const clips =
		task.status === 'ready'
			? await klapRequest<KlapClip[]>(this, 'GET', `/tasks/${segment(projectId)}/clips`, {
					itemIndex: i,
					what,
				})
			: [];
	return [{ json: toProject(task, clips) }];
}

export async function getAll(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll
		? MAX_PROJECTS_PER_PAGE
		: Math.min(this.getNodeParameter('limit', i) as number, MAX_PROJECTS_PER_PAGE);
	const tasks = await klapRequest<KlapTask[]>(this, 'GET', '/tasks', {
		qs: { limit },
		itemIndex: i,
	});
	return tasks.slice(0, limit).map((task) => ({ json: toProject(task) }));
}
