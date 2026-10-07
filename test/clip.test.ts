import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Klap } from '../nodes/Klap/Klap.node';
import { clip, createExecuteContext, httpError, path, rl, task } from './helpers';

const clock = { now: Date.parse('2026-10-07T12:00:00.000Z') };

vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return {
		...actual,
		// Polling waits advance the fake clock instead of sleeping.
		sleep: vi.fn(async (ms: number) => {
			clock.now += ms;
		}),
	};
});

beforeEach(() => {
	clock.now = Date.parse('2026-10-07T12:00:00.000Z');
	vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const exportRecord = (status: string, overrides: Record<string, unknown> = {}) => ({
	id: 'e1e1e1e1-0000-4000-8000-000000000001',
	status,
	src_url: status === 'ready' ? 'https://storage.googleapis.com/klap-renders/abc123.mp4' : null,
	estimated_ready_at: '2026-10-07T12:01:00.000Z',
	project_id: 'Xb7pQ2sLk9Wd',
	created_at: '2026-10-07T12:00:00.000Z',
	finished_at: status === 'ready' ? '2026-10-07T12:00:50.000Z' : null,
	name: 'Why most startups fail?',
	author_id: 'u1',
	folder_id: 'fold1234',
	scale: 1,
	watermarked: false,
	...overrides,
});

describe('Clip → Export', () => {
	it('starts one export and polls it until the MP4 is ready', async () => {
		const statuses = ['processing', 'processing', 'ready'];
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'export',
				clipId: rl('Xb7pQ2sLk9Wd'),
				waitForExport: true,
				timeoutMinutes: 10,
				download: false,
			},
			router: (request) => {
				if (request.method === 'POST')
					return { id: 'e1e1e1e1-0000-4000-8000-000000000001', projectId: 'Xb7pQ2sLk9Wd' };
				return exportRecord(statuses.shift() ?? 'ready');
			},
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(calls.filter((call) => call.request.method === 'POST')).toHaveLength(1);
		expect(path(calls[0].request)).toBe('/projects/Xb7pQ2sLk9Wd/exports');
		expect(calls[0].request.body).toEqual({});
		expect(calls).toHaveLength(4);
		expect(item.json).toEqual({
			id: 'e1e1e1e1-0000-4000-8000-000000000001',
			clip_id: 'Xb7pQ2sLk9Wd',
			status: 'ready',
			video_url: 'https://storage.googleapis.com/klap-renders/abc123.mp4',
			file_name: 'Why_most_startups_fail_.mp4',
			estimated_ready_at: '2026-10-07T12:01:00.000Z',
			created_at: '2026-10-07T12:00:00.000Z',
			finished_at: '2026-10-07T12:00:50.000Z',
		});
	});

	it('returns right away when told not to wait', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'export',
				clipId: rl('Xb7pQ2sLk9Wd'),
				waitForExport: false,
			},
			router: (request) => (request.method === 'POST' ? { id: 'e1' } : exportRecord('processing')),
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(calls).toHaveLength(2);
		expect(item.json).toMatchObject({ status: 'processing', video_url: null });
	});

	it('stops at the timeout and says how to get the export later', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'export',
				clipId: rl('Xb7pQ2sLk9Wd'),
				waitForExport: true,
				timeoutMinutes: 1,
			},
			router: (request) => (request.method === 'POST' ? { id: 'e1' } : exportRecord('processing')),
		});

		await expect(new Klap().execute.call(context)).rejects.toMatchObject({
			message: "The export isn't ready after 1 minutes",
			description: expect.stringContaining('export ID e1'),
		});
		// 1 minute at one check every 5 seconds, plus the first check.
		expect(calls.filter((call) => call.request.method === 'GET')).toHaveLength(13);
	});

	it('fails clearly when the render fails', async () => {
		const { context } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'export',
				clipId: rl('Xb7pQ2sLk9Wd'),
				waitForExport: true,
				timeoutMinutes: 10,
			},
			router: (request) => (request.method === 'POST' ? { id: 'e1' } : exportRecord('error')),
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			"Klap couldn't render this clip",
		);
	});

	it('downloads the MP4 for that export into a binary field', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'export',
				clipId: rl('Xb7pQ2sLk9Wd'),
				waitForExport: true,
				timeoutMinutes: 10,
				download: true,
				binaryPropertyName: 'video',
			},
			router: (request) => {
				if (request.method === 'POST') return { id: 'e1e1e1e1-0000-4000-8000-000000000001' };
				if (path(request).endsWith('/download')) {
					return {
						body: Buffer.from('mp4 bytes'),
						headers: {
							'content-disposition': 'attachment; filename="Why_most_startups_fail_.mp4"',
						},
					};
				}
				return exportRecord('ready');
			},
		});
		const [[item]] = await new Klap().execute.call(context);

		const download = calls.find((call) => path(call.request).endsWith('/download'));
		expect(download?.request).toMatchObject({
			url: 'https://api.klap.app/projects/Xb7pQ2sLk9Wd/download',
			qs: { export_id: 'e1e1e1e1-0000-4000-8000-000000000001' },
			encoding: 'arraybuffer',
			returnFullResponse: true,
		});
		expect(item.binary?.video).toMatchObject({
			fileName: 'Why_most_startups_fail_.mp4',
			mimeType: 'video/mp4',
			data: Buffer.from('mp4 bytes').toString('base64'),
		});
		expect(item.json.video_url).toBe('https://storage.googleapis.com/klap-renders/abc123.mp4');
	});

	it('maps plan limits to the plan message', async () => {
		const { context } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'export',
				clipId: rl('Xb7pQ2sLk9Wd'),
				waitForExport: true,
			},
			router: () => {
				throw httpError(402, {
					error_code: 'payment_required',
					message: 'Payment of Upgrade required.',
				});
			},
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			"This isn't included in your current Klap plan. See plans at https://klap.app/pricing.",
		);
	});
});

const accounts = [
	{
		id: 'yt1',
		provider: 'youtube',
		name: 'Acme',
		username: 'acme',
		profile_picture: '',
		settings: {},
		needs_reconnect: false,
	},
	{
		id: 'yt2',
		provider: 'youtube',
		name: 'Acme Clips',
		username: 'acmeclips',
		profile_picture: '',
		settings: {},
		needs_reconnect: false,
	},
	{
		id: 'tt1',
		provider: 'tiktok',
		name: 'Acme',
		username: 'acme.tt',
		profile_picture: '',
		settings: {},
		needs_reconnect: false,
	},
	{
		id: 'ig1',
		provider: 'instagram',
		name: 'Acme',
		username: 'acme.ig',
		profile_picture: '',
		settings: {},
		needs_reconnect: false,
	},
	{
		id: 'fb1',
		provider: 'facebook',
		name: 'Acme Page',
		username: 'acmepage',
		profile_picture: '',
		settings: {},
		needs_reconnect: false,
	},
	{
		id: 'li1',
		provider: 'linkedin',
		name: 'Acme Inc',
		username: 'acme-inc',
		profile_picture: '',
		settings: {},
		needs_reconnect: false,
	},
];

function scheduleContext(
	params: Record<string, unknown>,
	captionResponse = 'Klap wrote this caption',
) {
	return createExecuteContext({
		params: {
			resource: 'clip',
			operation: 'schedule',
			clipId: rl('Xb7pQ2sLk9Wd'),
			caption: '',
			publishAt: '',
			additionalFields: {},
			...params,
		},
		router: (request) => {
			const route = `${request.method} ${path(request)}`;
			if (route === 'GET /integrations/accounts') return accounts;
			if (route === 'GET /projects/Xb7pQ2sLk9Wd/caption') return { caption: captionResponse };
			if (route === 'POST /integrations/publications/batch') {
				const body = request.body as { creates: Array<Record<string, unknown>> };
				return {
					publications: body.creates.map((create) => ({ ...create, status: 'scheduled' })),
					deleted_ids: [],
				};
			}
			throw new Error(`unexpected ${route}`);
		},
	});
}

const batchBody = (calls: ReturnType<typeof scheduleContext>['calls']) =>
	calls.find((call) => path(call.request) === '/integrations/publications/batch')?.request.body as {
		time_zone: string;
		creates: Array<{
			id: string;
			provider: string;
			account_id: string;
			project_id: string;
			scheduled_at: string;
			post_info: Record<string, unknown>;
		}>;
	};

describe('Clip → Schedule', () => {
	it('builds post_info for every provider and outputs one item per post', async () => {
		const caption = 'Why most startups fail: they build before they listen. #startup';
		const { context, calls } = scheduleContext({
			accountIds: ['yt1', 'tt1', 'ig1', 'fb1', 'li1'],
			caption,
			publishAt: '2026-10-08T09:00:00',
			additionalFields: {
				timeZone: 'Europe/Paris',
				tiktokPrivacyLevel: 'FOLLOWER_OF_CREATOR',
				youtubeTitle: 'Why startups fail',
			},
		});

		const [items] = await new Klap().execute.call(context);

		const body = batchBody(calls);
		expect(body).toMatchObject({
			time_zone: 'Europe/Paris',
			expected_publications: [],
			updates: [],
			delete_ids: [],
		});
		const postInfo = Object.fromEntries(
			body.creates.map((create) => [create.provider, create.post_info]),
		);
		expect(postInfo.youtube).toEqual({
			title: 'Why startups fail',
			description: caption,
			tags: [],
			visibility: 'public',
			category_id: '22',
		});
		expect(postInfo.tiktok).toEqual({
			title: caption,
			privacy_level: 'FOLLOWER_OF_CREATOR',
			disable_duet: false,
			disable_stitch: false,
			disable_comment: false,
			video_cover_timestamp_ms: 0,
			brand_content_toggle: false,
			brand_organic_toggle: false,
			is_aigc: false,
		});
		expect(postInfo.instagram).toEqual({ caption, share_to_feed: true });
		expect(postInfo.facebook).toEqual({ caption });
		expect(postInfo.linkedin).toEqual({
			share_commentary: caption,
			media_title: '',
			media_description: '',
			visibility: 'PUBLIC',
		});
		// 09:00 in Paris (CEST, UTC+2) is 07:00 UTC.
		expect(new Set(body.creates.map((create) => create.scheduled_at))).toEqual(
			new Set(['2026-10-08T07:00:00.000Z']),
		);
		expect(
			body.creates.every(
				(create) => /^[0-9a-f-]{36}$/.test(create.id) && create.project_id === 'Xb7pQ2sLk9Wd',
			),
		).toBe(true);

		expect(items).toHaveLength(5);
		expect(items[0].json).toEqual({
			id: body.creates[0].id,
			clip_id: 'Xb7pQ2sLk9Wd',
			account_id: 'yt1',
			provider: 'youtube',
			account_name: 'Acme',
			scheduled_at: '2026-10-08T07:00:00.000Z',
			status: 'scheduled',
			calendar_url: 'https://klap.app/calendar',
		});
		expect(items.every((item) => (item.pairedItem as { item: number }).item === 0)).toBe(true);
	});

	it('posts now (in two minutes) with an AI caption when both are empty', async () => {
		const { context, calls } = scheduleContext(
			{ accountIds: ['yt1'] },
			'A caption Klap wrote that is longer than one hundred characters, so the YouTube title has to be cut right here at 100.',
		);

		await new Klap().execute.call(context);

		const captionCall = calls.find((call) => path(call.request).endsWith('/caption'));
		expect(captionCall?.request.qs).toEqual({ tone: 'casual' });
		const [create] = batchBody(calls).creates;
		expect(create.scheduled_at).toBe('2026-10-07T12:02:00.000Z');
		expect((create.post_info.title as string).length).toBe(100);
		expect(create.post_info.description).toContain('A caption Klap wrote');
		expect(batchBody(calls).time_zone).toBe('UTC');
	});

	it('requires a TikTok privacy level for TikTok accounts', async () => {
		const { context, calls } = scheduleContext({ accountIds: ['tt1'], caption: 'Hi' });

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'Choose who can see the TikTok post in TikTok Privacy.',
		);
		expect(calls.some((call) => call.request.method === 'POST')).toBe(false);
	});

	it('refuses two accounts of the same platform', async () => {
		const { context } = scheduleContext({ accountIds: ['yt1', 'yt2'], caption: 'Hi' });

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'A clip can be posted to one YouTube account at a time. Choose a single YouTube account.',
		);
	});

	it('refuses past times and unknown accounts', async () => {
		const past = scheduleContext({
			accountIds: ['yt1'],
			caption: 'Hi',
			publishAt: '2026-10-07T11:00:00Z',
		});
		await expect(new Klap().execute.call(past.context)).rejects.toThrow('is in the past');

		const unknown = scheduleContext({ accountIds: ['nope'], caption: 'Hi' });
		await expect(new Klap().execute.call(unknown.context)).rejects.toThrow(
			"Social account nope isn't connected to your Klap account",
		);
	});

	it('maps scheduling conflicts', async () => {
		const { context } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'schedule',
				clipId: rl('Xb7pQ2sLk9Wd'),
				caption: 'Hi',
				publishAt: '',
				additionalFields: {},
				accountIds: ['yt1'],
			},
			router: (request) => {
				if (request.method === 'GET') return accounts;
				throw httpError(409, {
					name: 'conflict',
					message: 'A provider already has a post on this short',
					error_code: 'duplicate_post',
				});
			},
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'This clip is already scheduled on one of these platforms. A clip can be posted once per platform.',
		);
	});
});

describe('Clip → Write Caption', () => {
	it('returns the AI caption for the clip', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'writeCaption',
				clipId: rl('Xb7pQ2sLk9Wd'),
				tone: 'funny',
				additionalFields: { instructions: 'Mention the free trial' },
			},
			router: () => ({ caption: 'Startups fail. Yours does not have to. Free trial in bio.' }),
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(calls[0].request.qs).toEqual({ tone: 'funny', prompt: 'Mention the free trial' });
		expect(item.json).toEqual({
			clip_id: 'Xb7pQ2sLk9Wd',
			caption: 'Startups fail. Yours does not have to. Free trial in bio.',
		});
	});
});

describe('Clip → Get Many', () => {
	it('returns ranked clips filtered by score, with the project filled in', async () => {
		const { context } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'getAll',
				projectId: rl('p1AbCdEfGhIjKlMn'),
				returnAll: true,
				options: { minViralityScore: 80 },
			},
			router: (request) =>
				path(request).endsWith('/clips')
					? [clip('c1', 91), clip('c2', 80), clip('c3', 79), clip('c4', null)]
					: task(),
		});

		const [items] = await new Klap().execute.call(context);

		expect(items.map((item) => [item.json.id, item.json.rank])).toEqual([
			['c1', 1],
			['c2', 2],
		]);
		expect(items[0].json).toMatchObject({
			project_name: 'My podcast ep. 12',
			project_url: 'https://klap.app/spaces/fold1234',
		});
	});

	it('explains that a processing project has no clips yet', async () => {
		const { context } = createExecuteContext({
			params: {
				resource: 'clip',
				operation: 'getAll',
				projectId: rl('p1AbCdEfGhIjKlMn'),
				returnAll: false,
				limit: 5,
			},
			router: () => task({ status: 'processing' }),
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'"My podcast ep. 12" is still processing. Its clips are expected around 2026-10-07T12:12:00.000Z.',
		);
	});
});
