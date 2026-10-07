import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { KlapTrigger } from '../nodes/Klap/KlapTrigger.node';
import { clip, createPollContext, path, task } from './helpers';

/** A fake account: projects newest first, clips per project. */
function account(projects: Array<Record<string, unknown>>, clips: Record<string, unknown[]> = {}) {
	return (request: IHttpRequestOptions) => {
		const route = path(request);
		if (route === '/tasks') return projects;
		const match = /^\/tasks\/([^/]+)\/clips$/.exec(route);
		if (match) return clips[match[1]] ?? [];
		throw new Error(`unexpected ${route}`);
	};
}

async function poll(
	params: Record<string, unknown>,
	router: (request: IHttpRequestOptions) => unknown,
	staticData: IDataObject,
	mode: 'manual' | 'trigger' = 'trigger',
) {
	const { context, calls } = createPollContext({ params, router, staticData, mode });
	const result = await new KlapTrigger().poll.call(context);
	return { items: result?.[0].map((item) => item.json) ?? null, calls };
}

describe('Klap Trigger: Project Ready', () => {
	const params = { event: 'projectReady', options: {} };

	it('does not fire for history on the first poll, then fires once per newly ready project', async () => {
		const staticData: IDataObject = {};
		const before = [task({ id: 'old1' }), task({ id: 'busy', status: 'processing' })];

		const first = await poll(params, account(before), staticData);
		expect(first.items).toBeNull();
		expect(first.calls).toHaveLength(1);
		expect(staticData.seenProjectIds).toEqual(['old1']);

		const after = [
			task({ id: 'new1', name: 'Fresh episode' }),
			task({ id: 'busy', status: 'ready' }),
			task({ id: 'old1' }),
		];
		const clips = { new1: [clip('a', 90), clip('b', 70)], busy: [clip('c', 60)] };
		const second = await poll(params, account(after, clips), staticData);
		expect(second.items?.map((item) => item.id)).toEqual(['new1', 'busy']);
		expect(second.items?.[0]).toMatchObject({
			clip_count: 2,
			clips: [
				expect.objectContaining({ id: 'a', rank: 1, project_name: 'Fresh episode' }),
				expect.objectContaining({ id: 'b', rank: 2 }),
			],
		});

		const third = await poll(params, account(after, clips), staticData);
		expect(third.items).toBeNull();
	});

	it('enriches at most 10 projects per poll and keeps the rest for the next one', async () => {
		const staticData: IDataObject = { event: 'projectReady', seenProjectIds: [] };
		const ready = Array.from({ length: 13 }, (_, n) => task({ id: `p${n}` }));

		const first = await poll(params, account(ready), staticData);
		expect(first.items).toHaveLength(10);
		expect(first.calls).toHaveLength(11);

		const second = await poll(params, account(ready), staticData);
		expect(second.items?.map((item) => item.id)).toEqual(['p10', 'p11', 'p12']);
	});

	it('records nothing when a poll fails halfway, so nothing is lost', async () => {
		const staticData: IDataObject = { event: 'projectReady', seenProjectIds: [] };
		const failing = (request: IHttpRequestOptions) => {
			if (path(request) === '/tasks') return [task({ id: 'a' }), task({ id: 'b' })];
			if (path(request) === '/tasks/b/clips') throw new Error('socket hang up');
			return [];
		};

		await expect(poll(params, failing, staticData)).rejects.toThrow();
		expect(staticData.seenProjectIds).toEqual([]);
	});

	it('returns the most recent ready project when tested, without recording it', async () => {
		const staticData: IDataObject = {};
		const { items } = await poll(
			params,
			account([task({ id: 'busy', status: 'processing' }), task({ id: 'r1' })], {
				r1: [clip('a', 80)],
			}),
			staticData,
			'manual',
		);

		expect(items?.map((item) => item.id)).toEqual(['r1']);
		expect(staticData).toEqual({});
	});

	it('explains an empty account when tested', async () => {
		await expect(poll(params, account([]), {}, 'manual')).rejects.toThrow(
			'No ready projects in your Klap account yet',
		);
	});
});

describe('Klap Trigger: New Clip', () => {
	it('fires once per clip of newly ready projects, honoring score and best N', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'newClip', options: { minViralityScore: 70, clipsPerProject: 2 } };

		const seeded = await poll(params, account([task({ id: 'old' })]), staticData);
		expect(seeded.items).toBeNull();
		expect(seeded.calls).toHaveLength(1);

		const clips = {
			fresh: [clip('c1', 95), clip('c2', 72), clip('c3', 71)],
			old: [clip('x', 99)],
		};
		const projects = [task({ id: 'fresh', name: 'Fresh episode' }), task({ id: 'old' })];
		const second = await poll(params, account(projects, clips), staticData);
		expect(second.items?.map((item) => item.id)).toEqual(['c1', 'c2']);
		expect(second.items?.[1]).toMatchObject({
			rank: 2,
			project_id: 'fresh',
			project_name: 'Fresh episode',
			preview_url: 'https://klap.app/embed/c2',
		});
		// Only the new project's clips were fetched.
		expect(second.calls.map((call) => path(call.request))).toEqual([
			'/tasks',
			'/tasks/fresh/clips',
		]);

		const third = await poll(params, account(projects, clips), staticData);
		expect(third.items).toBeNull();
		expect(third.calls).toHaveLength(1);
	});

	it('looks again at a ready project whose clips are not listed yet', async () => {
		const staticData: IDataObject = { event: 'newClip', seenProjectIds: [], seenClipIds: [] };
		const params = { event: 'newClip', options: {} };

		const early = await poll(params, account([task({ id: 'a' })], { a: [] }), staticData);
		expect(early.items).toBeNull();
		expect(staticData.seenProjectIds).toEqual([]);

		const later = await poll(
			params,
			account([task({ id: 'a' })], { a: [clip('c', 50)] }),
			staticData,
		);
		expect(later.items?.map((item) => item.id)).toEqual(['c']);
	});

	it('starts over when the event changes', async () => {
		const staticData: IDataObject = { event: 'projectReady', seenProjectIds: [] };
		const { items } = await poll(
			{ event: 'newClip', options: {} },
			account([task({ id: 'a' })], { a: [clip('c', 50)] }),
			staticData,
		);

		expect(items).toBeNull();
		expect(staticData).toMatchObject({ event: 'newClip', seenProjectIds: ['a'], seenClipIds: [] });
	});

	it('returns matching clips of a recent project when tested', async () => {
		const params = { event: 'newClip', options: { minViralityScore: 90 } };
		const { items } = await poll(
			params,
			account([task({ id: 'a' }), task({ id: 'b' })], {
				a: [clip('low', 50)],
				b: [clip('high', 93)],
			}),
			{},
			'manual',
		);

		expect(items?.map((item) => item.id)).toEqual(['high']);
	});
});

describe('Klap Trigger: Project Failed', () => {
	it('fires once per newly failed project with the reason', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'projectFailed', options: {} };

		await poll(
			params,
			account([task({ id: 'f0', status: 'error', error_code: 'video_private' })]),
			staticData,
		);

		const projects = [
			task({ id: 'f1', status: 'error', error_code: 'no_clip_generated' }),
			task({ id: 'f2', status: 'error', error_code: 'something_new' }),
			task({ id: 'f0', status: 'error', error_code: 'video_private' }),
		];
		const { items, calls } = await poll(params, account(projects), staticData);

		expect(calls).toHaveLength(1);
		expect(items).toEqual([
			expect.objectContaining({
				id: 'f1',
				status: 'error',
				error_message: "Klap couldn't find clip-worthy moments in this video.",
			}),
			expect.objectContaining({
				id: 'f2',
				error_message: "Klap couldn't process this video (something_new).",
			}),
		]);
		expect(items?.[0]).not.toHaveProperty('clips');
	});
});
