import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	CREATE_TIMEOUT_MS,
	MAX_INSTRUCTIONS_LENGTH,
	MAX_PROJECTS_PER_PAGE,
	WEB_URL,
} from '../shared/constants';
import { toProject } from '../shared/normalize';
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
	return [{ json: toProject(task) }];
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
