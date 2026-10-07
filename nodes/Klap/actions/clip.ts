import { randomUUID } from 'crypto';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import {
	CALENDAR_URL,
	DEFAULT_EXPORT_TIMEOUT_MINUTES,
	DOWNLOAD_TIMEOUT_MS,
	EXPORT_POLL_INTERVAL_MS,
	MAX_CAPTION_LENGTH,
	MAX_INSTRUCTIONS_LENGTH,
	MAX_YOUTUBE_TITLE_LENGTH,
	POST_NOW_DELAY_MS,
} from '../shared/constants';
import { projectErrorMessage, toClips, toExport } from '../shared/normalize';
import { postInfoFor, validateTargets } from '../shared/schedule';
import { isValidTimeZone, parseDateTime } from '../shared/time';
import { klapDownload, klapRequest, segment } from '../shared/transport';
import type {
	ExportOutput,
	KlapClip,
	KlapExport,
	KlapSocialAccount,
	KlapTask,
	ScheduledPostOutput,
} from '../shared/types';

const clipIdParam = (context: IExecuteFunctions, i: number) =>
	context.getNodeParameter('clipId', i, '', { extractValue: true }) as string;

export async function getAll(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const projectId = this.getNodeParameter('projectId', i, '', { extractValue: true }) as string;
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
	const options = this.getNodeParameter('options', i, {}) as { minViralityScore?: number };
	const what = `project ${projectId}`;

	const task = await klapRequest<KlapTask>(this, 'GET', `/tasks/${segment(projectId)}`, {
		itemIndex: i,
		what,
	});
	if (task.status === 'processing') {
		throw new NodeOperationError(
			this.getNode(),
			`"${task.name}" is still processing. Its clips are expected around ${task.estimated_ready_at}.`,
			{
				itemIndex: i,
				description:
					'Use the Klap Trigger (Project Ready or New Clip) to run a workflow when the clips are ready.',
			},
		);
	}
	if (task.status === 'error') {
		throw new NodeOperationError(this.getNode(), projectErrorMessage(task.error_code), {
			itemIndex: i,
		});
	}
	if (task.status === 'expired') {
		throw new NodeOperationError(
			this.getNode(),
			`"${task.name}" expired and its clips are no longer available.`,
			{ itemIndex: i },
		);
	}

	const clips = await klapRequest<KlapClip[]>(this, 'GET', `/tasks/${segment(projectId)}/clips`, {
		itemIndex: i,
		what,
	});
	const minScore = options.minViralityScore ?? 0;
	return toClips(clips, task)
		.filter((clip) => minScore <= 0 || (clip.virality_score ?? 0) >= minScore)
		.slice(0, limit)
		.map((clip) => ({ json: clip }));
}

/** Content-Disposition `filename="…"`, if any. */
function dispositionFileName(header: unknown): string | undefined {
	if (typeof header !== 'string') return undefined;
	const match = /filename="?([^";]+)"?/i.exec(header);
	return match?.[1];
}

export async function exportClip(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const clipId = clipIdParam(this, i);
	const wait = this.getNodeParameter('waitForExport', i, true) as boolean;
	const what = `clip ${clipId}`;

	const created = await klapRequest<{ id: string }>(
		this,
		'POST',
		`/projects/${segment(clipId)}/exports`,
		{ body: {}, itemIndex: i, what },
	);
	const exportPath = `/projects/${segment(clipId)}/exports/${segment(created.id)}`;
	const fetchExport = async () =>
		await klapRequest<KlapExport>(this, 'GET', exportPath, {
			itemIndex: i,
			what: `export ${created.id}`,
		});

	let record = await fetchExport();
	if (!wait) return [{ json: toExport(record, clipId) }];

	const timeoutMinutes = this.getNodeParameter(
		'timeoutMinutes',
		i,
		DEFAULT_EXPORT_TIMEOUT_MINUTES,
	) as number;
	const deadline = Date.now() + timeoutMinutes * 60 * 1000;
	const cancelSignal = this.getExecutionCancelSignal?.();
	while (record.status === 'processing') {
		if (cancelSignal?.aborted) {
			throw new NodeOperationError(this.getNode(), 'The execution was canceled', {
				itemIndex: i,
			});
		}
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`The export isn't ready after ${timeoutMinutes} minutes`,
				{
					itemIndex: i,
					description: `Klap is still rendering it. Use Export → Get with clip ID ${clipId} and export ID ${created.id} to get it later, or raise Timeout (Minutes).`,
				},
			);
		}
		await sleep(EXPORT_POLL_INTERVAL_MS);
		record = await fetchExport();
	}
	if (record.status === 'error') {
		throw new NodeOperationError(this.getNode(), "Klap couldn't render this clip", {
			itemIndex: i,
			description: 'Try exporting it again. If it keeps failing, contact support@klap.app.',
		});
	}

	const output: ExportOutput = toExport(record, clipId);
	const download = this.getNodeParameter('download', i, false) as boolean;
	if (!download) return [{ json: output }];

	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
	// Always pass export_id: without it Klap starts a new render.
	const file = await klapDownload(this, `/projects/${segment(clipId)}/download`, {
		qs: { export_id: record.id },
		itemIndex: i,
		what,
		timeout: DOWNLOAD_TIMEOUT_MS,
	});
	const fileName = dispositionFileName(file.headers['content-disposition']) ?? output.file_name;
	const binary = await this.helpers.prepareBinaryData(file.body, fileName, 'video/mp4');
	return [{ json: output, binary: { [binaryPropertyName]: binary } }];
}

type ScheduleFields = {
	timeZone?: string;
	tiktokPrivacyLevel?: string;
	youtubeTitle?: string;
};

/** n8n hands date-times over as strings, or as Luxon/JS dates from expressions. */
function dateTimeParamToString(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object' && typeof (value as { toISO?: unknown }).toISO === 'function') {
		return String((value as { toISO: () => string }).toISO());
	}
	return String(value);
}

export async function schedule(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const clipId = clipIdParam(this, i);
	const accountIds = this.getNodeParameter('accountIds', i, []) as string[];
	const publishAt = dateTimeParamToString(this.getNodeParameter('publishAt', i, ''));
	let caption = (this.getNodeParameter('caption', i, '') as string).trim();
	const fields = this.getNodeParameter('additionalFields', i, {}) as ScheduleFields;
	const timeZone = fields.timeZone?.trim() || 'UTC';
	const youtubeTitle = fields.youtubeTitle?.trim() || undefined;
	const fail = (message: string, description?: string) =>
		new NodeOperationError(this.getNode(), message, { itemIndex: i, description });

	if (!accountIds.length) {
		throw fail('Choose at least one social account in Social Account Names or IDs.');
	}
	if (caption.length > MAX_CAPTION_LENGTH) {
		throw fail(`Caption can be up to ${MAX_CAPTION_LENGTH} characters. It has ${caption.length}.`);
	}
	if (youtubeTitle && youtubeTitle.length > MAX_YOUTUBE_TITLE_LENGTH) {
		throw fail(`YouTube Title can be up to ${MAX_YOUTUBE_TITLE_LENGTH} characters.`);
	}
	if (!isValidTimeZone(timeZone)) {
		throw fail(`"${timeZone}" isn't a time zone Klap knows. Use an IANA name, e.g. Europe/Paris.`);
	}

	let scheduledAt: Date;
	if (publishAt.trim()) {
		const parsed = parseDateTime(publishAt, timeZone);
		if (!parsed) {
			throw fail(
				`Publish At "${publishAt}" isn't a date and time`,
				'Use ISO 8601, e.g. 2026-10-08T09:00:00 or 2026-10-08T09:00:00+02:00, or leave it empty to post now.',
			);
		}
		if (parsed.getTime() <= Date.now()) {
			throw fail(
				`Publish At (${parsed.toISOString()}) is in the past`,
				'Choose a future time, or leave Publish At empty to post now.',
			);
		}
		scheduledAt = parsed;
	} else {
		scheduledAt = new Date(Date.now() + POST_NOW_DELAY_MS);
	}

	const accounts = await klapRequest<KlapSocialAccount[]>(this, 'GET', '/integrations/accounts', {
		itemIndex: i,
	});
	const targets: KlapSocialAccount[] = [];
	for (const accountId of accountIds) {
		const account = accounts.find((candidate) => candidate.id === accountId);
		if (!account) {
			throw fail(
				`Social account ${accountId} isn't connected to your Klap account`,
				`Connect it at ${CALENDAR_URL}, then choose it from the list.`,
			);
		}
		targets.push(account);
	}
	const invalid = validateTargets(targets, fields.tiktokPrivacyLevel);
	if (invalid) throw fail(invalid);

	if (!caption) {
		// "Klap writes one": the same AI caption Write Caption returns.
		const written = await klapRequest<{ caption: string }>(
			this,
			'GET',
			`/projects/${segment(clipId)}/caption`,
			{ qs: { tone: 'casual' }, itemIndex: i, what: `clip ${clipId}` },
		);
		caption = (written.caption ?? '').slice(0, MAX_CAPTION_LENGTH);
	}

	const scheduledAtIso = scheduledAt.toISOString();
	const creates = targets.map((account) => ({
		id: randomUUID(),
		project_id: clipId,
		account_id: account.id,
		provider: account.provider,
		scheduled_at: scheduledAtIso,
		post_info: postInfoFor(account.provider, {
			caption,
			youtubeTitle,
			tiktokPrivacyLevel: fields.tiktokPrivacyLevel,
		}),
	}));

	const response = await klapRequest<{ publications?: IDataObject[] }>(
		this,
		'POST',
		'/integrations/publications/batch',
		{
			body: {
				time_zone: timeZone,
				expected_publications: [],
				creates,
				updates: [],
				delete_ids: [],
			},
			itemIndex: i,
			what: `clip ${clipId}`,
		},
	);

	return creates.map((post, index) => {
		const row = response.publications?.find((publication) => publication.id === post.id);
		const output: ScheduledPostOutput = {
			id: post.id,
			clip_id: clipId,
			account_id: post.account_id,
			provider: post.provider,
			account_name: targets[index].name,
			scheduled_at: post.scheduled_at,
			status: typeof row?.status === 'string' ? row.status : 'scheduled',
			calendar_url: CALENDAR_URL,
		};
		return { json: output };
	});
}

export async function writeCaption(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const clipId = clipIdParam(this, i);
	const tone = this.getNodeParameter('tone', i, 'casual') as string;
	const fields = this.getNodeParameter('additionalFields', i, {}) as { instructions?: string };
	const instructions = fields.instructions?.trim();
	if (instructions && instructions.length > MAX_INSTRUCTIONS_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`Instructions can be up to ${MAX_INSTRUCTIONS_LENGTH} characters. Shorten them and try again.`,
			{ itemIndex: i },
		);
	}
	const qs: IDataObject = { tone };
	if (instructions) qs.prompt = instructions;
	const response = await klapRequest<{ caption: string }>(
		this,
		'GET',
		`/projects/${segment(clipId)}/caption`,
		{ qs, itemIndex: i, what: `clip ${clipId}` },
	);
	return [{ json: { clip_id: clipId, caption: response.caption } }];
}
