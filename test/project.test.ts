import { describe, expect, it } from 'vitest';

import { buildCreateBody } from '../nodes/Klap/actions/project';
import { Klap } from '../nodes/Klap/Klap.node';
import { createExecuteContext, httpError, path, rl, task, clip } from './helpers';

const SIGNED_UPLOAD_URL =
	'https://storage.googleapis.com/klap-upload-tmp-regional/f00d.mp4?X-Goog-Signature=up';
const SIGNED_READ_URL =
	'https://storage.googleapis.com/klap-upload-tmp-regional/f00d.mp4?X-Goog-Algorithm=GOOG4&X-Goog-Signature=read';

describe('buildCreateBody', () => {
	it('sends only the source when nothing else is set', () => {
		expect(buildCreateBody('https://youtu.be/x', {})).toEqual({
			source_video_url: 'https://youtu.be/x',
		});
	});

	it('maps every field to the video-to-shorts body', () => {
		expect(
			buildCreateBody(
				'https://youtu.be/x',
				{
					aspectRatio: '4:5',
					clipLength: '90',
					instructions: '  the funniest moments  ',
					language: 'FR',
					maxClipCount: 12,
				},
				'Episode 12',
			),
		).toEqual({
			source_video_url: 'https://youtu.be/x',
			name: 'Episode 12',
			max_clip_count: 12,
			target_duration: 90,
			min_duration: 20,
			language: 'fr',
			curation_prompt: 'the funniest moments',
			dimensions: { width: 1080, height: 1350 },
		});
	});

	it('sends min_duration = min(20, target) and nothing for Auto', () => {
		expect(buildCreateBody('u', { clipLength: '15' })).toMatchObject({
			target_duration: 15,
			min_duration: 15,
		});
		expect(buildCreateBody('u', { clipLength: '0' })).not.toHaveProperty('target_duration');
		expect(buildCreateBody('u', { aspectRatio: '9:16' }).dimensions).toEqual({
			width: 1080,
			height: 1920,
		});
		expect(buildCreateBody('u', { aspectRatio: '16:9' }).dimensions).toEqual({
			width: 1920,
			height: 1080,
		});
	});
});

describe('Project → Create', () => {
	it('creates from a URL and returns the project summary', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'project',
				operation: 'create',
				source: 'url',
				videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				additionalFields: { maxClipCount: 5 },
			},
			router: (request) => {
				if (request.method === 'POST' && path(request) === '/tasks/video-to-shorts') {
					return { id: 'p1AbCdEfGhIjKlMn', status: 'processing' };
				}
				if (path(request) === '/tasks/p1AbCdEfGhIjKlMn') return task({ status: 'processing' });
				throw new Error(`unexpected ${request.method} ${request.url}`);
			},
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(calls[0].request.body).toEqual({
			source_video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			max_clip_count: 5,
		});
		expect(calls[0].request.timeout).toBeGreaterThanOrEqual(60_000);
		expect(item.json).toEqual({
			id: 'p1AbCdEfGhIjKlMn',
			name: 'My podcast ep. 12',
			status: 'processing',
			error_code: null,
			error_message: null,
			source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
			created_at: '2026-10-07T12:00:00.000Z',
			estimated_ready_at: '2026-10-07T12:12:00.000Z',
			url: 'https://klap.app/spaces/fold1234',
		});
		expect(item.pairedItem).toEqual({ item: 0 });
	});

	it('uploads a binary file in three steps, then clips the signed read URL', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'project',
				operation: 'create',
				source: 'binary',
				binaryPropertyName: 'data',
				additionalFields: {},
			},
			items: [
				{
					json: {},
					binary: {
						data: {
							data: Buffer.from('fake video bytes').toString('base64'),
							mimeType: 'video/quicktime',
							fileName: 'Team offsite.mov',
						},
					},
				},
			],
			router: (request) => {
				const route = `${request.method} ${path(request)}`;
				if (route === 'POST /media/upload') {
					return { signed_upload_url: SIGNED_UPLOAD_URL, filename: 'f00d.mov' };
				}
				if (request.url === SIGNED_UPLOAD_URL) return '';
				if (route === 'GET /media/upload') return { signed_read_url: SIGNED_READ_URL };
				if (route === 'POST /tasks/video-to-shorts') return { id: 'p1AbCdEfGhIjKlMn' };
				if (route === 'GET /tasks/p1AbCdEfGhIjKlMn') {
					return task({
						status: 'processing',
						name: 'Team offsite.mov',
						source_url: SIGNED_READ_URL,
					});
				}
				throw new Error(`unexpected ${route}`);
			},
		});

		const [[item]] = await new Klap().execute.call(context);

		const [step1, step2, step3, create] = calls;
		expect(step1).toMatchObject({
			authenticated: true,
			request: { method: 'POST', body: { type: 'video/quicktime' } },
		});
		expect(step2.authenticated).toBe(false);
		expect(step2.request).toMatchObject({
			method: 'PUT',
			url: SIGNED_UPLOAD_URL,
			headers: { 'Content-Type': 'video/quicktime', 'Content-Length': 16 },
		});
		expect(step2.request.headers).not.toHaveProperty('Authorization');
		expect(Buffer.isBuffer(step2.request.body)).toBe(true);
		expect(step3.request.qs).toEqual({ filename: 'f00d.mov' });
		expect(create.request.body).toEqual({
			source_video_url: SIGNED_READ_URL,
			name: 'Team offsite.mov',
		});
		// A signed upload URL is never passed on.
		expect(item.json.source_url).toBeNull();
	});

	it('streams binaries stored outside memory with their exact size', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'project',
				operation: 'create',
				source: 'binary',
				binaryPropertyName: 'video',
				additionalFields: { projectName: 'Keynote' },
			},
			items: [
				{
					json: {},
					binary: {
						video: {
							id: 'filesystem-v2:abc',
							data: 'filesystem-v2',
							mimeType: 'application/octet-stream',
							fileName: 'keynote.mp4',
						},
					},
				},
			],
			binaryStreams: { 'filesystem-v2:abc': { content: Buffer.from('x'), fileSize: 123456789 } },
			router: (request) => {
				const route = `${request.method} ${path(request)}`;
				if (route === 'POST /media/upload')
					return { signed_upload_url: SIGNED_UPLOAD_URL, filename: 'f00d.mp4' };
				if (request.url === SIGNED_UPLOAD_URL) return '';
				if (route === 'GET /media/upload') return { signed_read_url: SIGNED_READ_URL };
				if (route === 'POST /tasks/video-to-shorts') return { id: 'p1AbCdEfGhIjKlMn' };
				return task({ status: 'processing' });
			},
		});

		await new Klap().execute.call(context);

		expect(calls[0].request.body).toEqual({ type: 'video/mp4' });
		expect(calls[1].request.headers).toMatchObject({
			'Content-Length': 123456789,
			'Content-Type': 'video/mp4',
		});
		expect(calls[1].request.body).toMatchObject({ streamOf: 'filesystem-v2:abc' });
		expect(calls[3].request.body).toMatchObject({ name: 'Keynote' });
	});

	it('refuses file types Klap cannot clip before uploading anything', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'project',
				operation: 'create',
				source: 'binary',
				binaryPropertyName: 'data',
				additionalFields: {},
			},
			items: [
				{ json: {}, binary: { data: { data: '', mimeType: 'audio/mpeg', fileName: 'talk.mp3' } } },
			],
			router: () => {
				throw new Error('no request expected');
			},
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'Klap accepts MP4, MOV and WebM videos. The file in "data" is audio/mpeg.',
		);
		expect(calls).toHaveLength(0);
	});

	it('still returns the project when the follow-up GET fails (never creates twice)', async () => {
		const { context, calls } = createExecuteContext({
			params: {
				resource: 'project',
				operation: 'create',
				source: 'url',
				videoUrl: 'https://example.com/v.mp4',
				additionalFields: {},
			},
			router: (request) => {
				if (request.method === 'POST') {
					return {
						id: 'p1AbCdEfGhIjKlMn',
						status: 'processing',
						error_code: null,
						src_name: 'v.mp4',
						src_url: 'https://example.com/v.mp4',
						created_at: '2026-10-07T12:00:00.000Z',
						estimated_time_seconds: 600,
						output_type: 'folder',
						output_id: 'fold1234',
					};
				}
				throw httpError(503, { name: 'service-unavailable', message: 'busy' });
			},
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(calls.filter((call) => call.request.method === 'POST')).toHaveLength(1);
		expect(item.json).toMatchObject({
			id: 'p1AbCdEfGhIjKlMn',
			status: 'processing',
			name: 'v.mp4',
			estimated_ready_at: '2026-10-07T12:10:00.000Z',
			url: 'https://klap.app/spaces/fold1234',
		});
	});

	it('maps a 422 to the user-facing message', async () => {
		const { context } = createExecuteContext({
			params: {
				resource: 'project',
				operation: 'create',
				source: 'url',
				videoUrl: 'https://youtu.be/x',
				additionalFields: {},
			},
			router: () => {
				throw httpError(422, {
					name: 'unprocessable-entity',
					message: 'unprocessable-entity',
					error_code: 'video_too_short',
				});
			},
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'The video is too short to clip (minimum 10 seconds).',
		);
	});
});

describe('Project → Get / Get Many', () => {
	it('includes ranked clips once the project is ready', async () => {
		const { context } = createExecuteContext({
			params: { resource: 'project', operation: 'get', projectId: rl('p1AbCdEfGhIjKlMn') },
			router: (request) =>
				path(request).endsWith('/clips') ? [clip('c1', 91), clip('c2', 80)] : task(),
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(item.json.clip_count).toBe(2);
		expect(item.json.clips).toEqual([
			expect.objectContaining({
				id: 'c1',
				rank: 1,
				preview_url: 'https://klap.app/embed/c1',
				project_id: 'p1AbCdEfGhIjKlMn',
				project_name: 'My podcast ep. 12',
				project_url: 'https://klap.app/spaces/fold1234',
			}),
			expect.objectContaining({ id: 'c2', rank: 2 }),
		]);
	});

	it('explains failed projects in error_message', async () => {
		const { context } = createExecuteContext({
			params: { resource: 'project', operation: 'get', projectId: rl('p1AbCdEfGhIjKlMn') },
			router: () => task({ status: 'error', error_code: 'video_members_only' }),
		});

		const [[item]] = await new Klap().execute.call(context);

		expect(item.json).toMatchObject({
			status: 'error',
			error_code: 'video_members_only',
			error_message: 'The YouTube video is members-only.',
			clip_count: 0,
			clips: [],
		});
	});

	it('says what was not found', async () => {
		const { context } = createExecuteContext({
			params: { resource: 'project', operation: 'get', projectId: rl('nope') },
			router: () => {
				throw httpError(404, { name: 'not-found', message: 'Task not found.' });
			},
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			'Not found in your Klap account: project nope.',
		);
	});

	it('lists the most recent projects up to the limit', async () => {
		const { context, calls } = createExecuteContext({
			params: { resource: 'project', operation: 'getAll', returnAll: false, limit: 2 },
			router: () => [task({ id: 'a' }), task({ id: 'b' })],
		});

		const [items] = await new Klap().execute.call(context);

		expect(calls[0].request.qs).toEqual({ limit: 2 });
		expect(items.map((item) => item.json.id)).toEqual(['a', 'b']);
		expect(items[0].json).not.toHaveProperty('clips');
	});
});
