import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Klap } from '../nodes/Klap/Klap.node';
import { describeKlapError, toKlapError } from '../nodes/Klap/shared/errors';
import { createExecuteContext, httpError, rl, testNode } from './helpers';

describe('describeKlapError', () => {
	it.each([
		[401, {}, 'Your Klap connection expired. Reconnect your Klap account.'],
		[
			402,
			{ error_code: 'subscription_paused' },
			'Your Klap subscription is paused. Update it at https://klap.app/billing to continue.',
		],
		[
			402,
			{ error_code: 'subscription_past_due' },
			'Your Klap subscription is past due. Update it at https://klap.app/billing to continue.',
		],
		[
			402,
			{ error_code: 'clip_limit_reached', required_plan: 'pro-plus' },
			"This isn't included in your current Klap plan (available on the Pro+ plan). See plans at https://klap.app/pricing.",
		],
		[
			402,
			{ error_code: 'payment_required', message: 'Payment of Upgrade required.' },
			"This isn't included in your current Klap plan. See plans at https://klap.app/pricing.",
		],
		[
			422,
			{ error_code: 'invalid_video' },
			"Klap couldn't read this video. Use a public link or a direct link to the file.",
		],
		[422, { error_code: 'yt_video_not_available' }, "This YouTube video isn't available."],
		[422, { error_code: 'drm_protected' }, 'This video is DRM-protected.'],
		[422, { error_code: 'age_restricted' }, 'This YouTube video is age-restricted.'],
		[422, { error_code: 'video_too_long' }, 'The video is longer than your plan allows.'],
		[422, { error_code: 'no_audio_stream' }, 'The video has no audio.'],
		[422, { error_code: 'no_video_stream' }, 'The file has no video track.'],
		[422, { error_code: 'invalid_source_range' }, 'invalid_source_range'],
		[404, { message: 'Task not found.' }, 'Not found in your Klap account: project abc.'],
		[400, { message: 'Project not found' }, 'Not found in your Klap account: project abc.'],
		[
			500,
			{ message: 'Internal server error' },
			'Klap is temporarily unavailable. Try again in a minute.',
		],
		[
			503,
			{ message: 'Scheduling is busy. Refresh the schedule before trying again.' },
			'Klap is temporarily unavailable. Try again in a minute.',
		],
		[
			504,
			{ error: 'Export timed out or failed.' },
			'Klap is temporarily unavailable. Try again in a minute.',
		],
	])('HTTP %i %j', (status, body, message) => {
		expect(describeKlapError(status, body, 'project abc').message).toBe(message);
	});

	it('keeps the error code for support', () => {
		expect(
			describeKlapError(402, { error_code: 'video_limit_reached', required_plan: 'pro' })
				.description,
		).toBe('Klap error code: video_limit_reached');
	});
});

describe('toKlapError', () => {
	it('survives NodeApiError construction unchanged (n8n rewrites some messages)', () => {
		const messages = [
			[402, { error_code: 'subscription_past_due' }],
			[422, { error_code: 'video_too_short' }],
			[500, {}],
			[401, {}],
		] as const;
		for (const [status, body] of messages) {
			const error = toKlapError(testNode, httpError(status, body), { itemIndex: 0 });
			expect(error).toBeInstanceOf(NodeApiError);
			expect(error.message).toBe(describeKlapError(status, body).message);
			expect((error as NodeApiError).httpCode).toBe(String(status));
			expect(error.context.itemIndex).toBe(0);
		}
	});

	it('reads JSON error bodies of binary downloads', () => {
		const body = Buffer.from(
			JSON.stringify({ error_code: 'subscription_paused', message: 'payment-required' }),
		);
		expect(toKlapError(testNode, httpError(402, body)).message).toBe(
			'Your Klap subscription is paused. Update it at https://klap.app/billing to continue.',
		);
	});

	it('asks to reconnect when n8n could not refresh the token', () => {
		const refreshFailed = new NodeOperationError(
			testNode,
			'The credential "Klap account" needs to be reconnected.',
		);
		expect(toKlapError(testNode, refreshFailed).message).toBe(
			'Your Klap connection expired. Reconnect your Klap account.',
		);
	});

	it('asks to reconnect when the token endpoint refuses the refresh token', () => {
		// client-oauth2's AuthError, as httpRequestWithAuthentication wraps it.
		const authError = Object.assign(new Error('The authorization grant is invalid or expired'), {
			code: 'EAUTH',
			body: { error: 'invalid_grant' },
		});
		const wrapped = new NodeApiError(testNode, authError as never);
		expect(toKlapError(testNode, wrapped).message).toBe(
			'Your Klap connection expired. Reconnect your Klap account.',
		);
	});

	it('passes validation errors through', () => {
		const validation = new NodeOperationError(
			testNode,
			'Choose who can see the TikTok post in TikTok Privacy.',
		);
		expect(toKlapError(testNode, validation)).toBe(validation);
	});
});

describe('continueOnFail', () => {
	it('outputs the error for the failing item and goes on with the next', async () => {
		let call = 0;
		const { context } = createExecuteContext({
			params: { resource: 'project', operation: 'get', projectId: rl('p1') },
			items: [{ json: {} }, { json: {} }],
			continueOnFail: true,
			router: (request) => {
				call += 1;
				if (call === 1) throw httpError(404, { message: 'Task not found.' });
				return request.url.endsWith('/clips')
					? []
					: { id: 'p1', status: 'processing', name: 'Ep', created_at: '', estimated_ready_at: '' };
			},
		});

		const [items] = await new Klap().execute.call(context);

		expect(items).toEqual([
			{ json: { error: 'Not found in your Klap account: project p1.' }, pairedItem: { item: 0 } },
			expect.objectContaining({
				json: expect.objectContaining({ id: 'p1' }),
				pairedItem: { item: 1 },
			}),
		]);
	});

	it('throws with the item index otherwise', async () => {
		const { context } = createExecuteContext({
			params: { resource: 'project', operation: 'get', projectId: rl('p1') },
			items: [{ json: {} }, { json: {} }],
			router: () => {
				throw httpError(503, {});
			},
		});

		await expect(new Klap().execute.call(context)).rejects.toMatchObject({
			message: 'Klap is temporarily unavailable. Try again in a minute.',
			context: { itemIndex: 0 },
		});
	});
});
