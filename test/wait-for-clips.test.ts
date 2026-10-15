import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';

import { Klap } from '../nodes/Klap/Klap.node';
import { toProject } from '../nodes/Klap/shared/normalize';
import type { KlapTask } from '../nodes/Klap/shared/types';
import { clip, createExecuteContext, path, task, testNode } from './helpers';

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

const PROJECT_ID = 'p1AbCdEfGhIjKlMn';

const createParams = (extra: Record<string, unknown> = {}) => ({
	resource: 'project',
	operation: 'create',
	source: 'url',
	videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
	additionalFields: { maxClipCount: 2 },
	...extra,
});

/** Klap answering "processing" until `readyAfterMs`, then `final`. */
function klap(options: {
	readyAfterMs: number;
	final?: Record<string, unknown>;
	clips?: unknown[];
}) {
	const start = clock.now;
	const projectGets: number[] = [];
	const router = (request: IHttpRequestOptions) => {
		if (request.method === 'POST' && path(request) === '/tasks/video-to-shorts') {
			return { id: PROJECT_ID, status: 'processing' };
		}
		if (path(request) === `/tasks/${PROJECT_ID}`) {
			projectGets.push(clock.now - start);
			return clock.now - start >= options.readyAfterMs
				? task(options.final ?? { status: 'ready' })
				: task({ status: 'processing' });
		}
		if (path(request) === `/tasks/${PROJECT_ID}/clips`) {
			return options.clips ?? [clip('c1BestClip01', 91), clip('c2NextClip02', 78)];
		}
		throw new Error(`unexpected ${request.method} ${request.url}`);
	};
	return { router, projectGets };
}

function withVersion(context: IExecuteFunctions, typeVersion: number) {
	(context as unknown as { getNode: () => unknown }).getNode = () => ({ ...testNode, typeVersion });
	return context;
}

describe('Project → Create with Wait for Clips', () => {
	it('waits until the project is ready, then outputs one item per clip, best first', async () => {
		const { router, projectGets } = klap({ readyAfterMs: 4 * 60 * 1000 });
		const { context, calls } = createExecuteContext({
			params: createParams({ waitForClips: true }),
			router,
		});

		const [items] = await new Klap().execute.call(context);

		expect(items.map((item) => item.json.id)).toEqual(['c1BestClip01', 'c2NextClip02']);
		expect(items[0].json).toMatchObject({
			rank: 1,
			virality_score: 91,
			preview_url: 'https://klap.app/embed/c1BestClip01',
			editor_url: 'https://klap.app/editor/c1BestClip01',
			project_id: PROJECT_ID,
			project_url: 'https://klap.app/spaces/fold1234',
		});
		expect(items.every((item) => (item.pairedItem as { item: number }).item === 0)).toBe(true);
		// One create, every check 15 s apart, and nothing exported.
		expect(calls.filter((call) => call.request.method === 'POST')).toHaveLength(1);
		const checks = projectGets.slice(1);
		checks.slice(1).forEach((at, index) => expect(at - checks[index]).toBe(15_000));
		expect(calls.some((call) => path(call.request).includes('/exports'))).toBe(false);
	});

	it('waits by default from node version 1.1, but not in version 1', async () => {
		const v11 = createExecuteContext({ params: createParams(), router: klap({ readyAfterMs: 60_000 }).router });
		const [clips] = await new Klap().execute.call(withVersion(v11.context, 1.1));
		expect(clips).toHaveLength(2);

		const v1 = createExecuteContext({ params: createParams(), router: klap({ readyAfterMs: 60_000 }).router });
		const [projects] = await new Klap().execute.call(withVersion(v1.context, 1));
		expect(projects).toHaveLength(1);
		expect(projects[0].json).toMatchObject({ id: PROJECT_ID, status: 'processing' });
	});

	it("fails with Klap's reason when the project fails", async () => {
		const failed = { status: 'error', error_code: 'video_too_long' };
		const { context } = createExecuteContext({
			params: createParams({ waitForClips: true }),
			router: klap({ readyAfterMs: 60_000, final: failed }).router,
		});

		const error = await new Klap().execute.call(context).catch((caught: Error) => caught);

		const expected = toProject(task(failed) as unknown as KlapTask).error_message;
		expect(expected).toBeTruthy();
		expect((error as Error).message).toBe(expected);
	});

	it('gives up after the timeout with the project ID, without creating it again', async () => {
		const { context, calls } = createExecuteContext({
			params: createParams({ waitForClips: true, waitTimeoutMinutes: 5 }),
			router: klap({ readyAfterMs: 60 * 60 * 1000 }).router,
		});

		const error = await new Klap().execute.call(context).catch((caught: Error) => caught);

		expect((error as Error).message).toBe('Klap is still clipping this video after 5 minutes');
		expect((error as { description?: string }).description).toContain(PROJECT_ID);
		expect(calls.filter((call) => call.request.method === 'POST')).toHaveLength(1);
		expect(clock.now - Date.parse('2026-10-07T12:00:00.000Z')).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);
	});

	it('fails clearly when Klap found no clips', async () => {
		const { context } = createExecuteContext({
			params: createParams({ waitForClips: true }),
			router: klap({ readyAfterMs: 30_000, clips: [] }).router,
		});

		await expect(new Klap().execute.call(context)).rejects.toThrow(
			"Klap didn't find any clips in this video",
		);
	});

	it('reports the failure in an error item with Continue On Fail', async () => {
		const { context } = createExecuteContext({
			params: createParams({ waitForClips: true, waitTimeoutMinutes: 1 }),
			router: klap({ readyAfterMs: 60 * 60 * 1000 }).router,
			continueOnFail: true,
		});

		const [items] = await new Klap().execute.call(context);

		expect(items).toEqual([
			{ json: { error: 'Klap is still clipping this video after 1 minute' }, pairedItem: { item: 0 } },
		]);
	});
});
