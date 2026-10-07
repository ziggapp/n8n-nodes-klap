import type { INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { BILLING_URL, CALENDAR_URL, PRICING_URL } from './constants';
import type { KlapErrorBody } from './types';

export const RECONNECT_MESSAGE = 'Your Klap connection expired. Reconnect your Klap account.';
export const UNAVAILABLE_MESSAGE = 'Klap is temporarily unavailable. Try again in a minute.';

/** 422 `error_code`s from POST /tasks/video-to-shorts. */
const VIDEO_ERROR_MESSAGES: Record<string, string> = {
	invalid_video: "Klap couldn't read this video. Use a public link or a direct link to the file.",
	yt_video_not_available: "This YouTube video isn't available.",
	drm_protected: 'This video is DRM-protected.',
	age_restricted: 'This YouTube video is age-restricted.',
	video_too_short: 'The video is too short to clip (minimum 10 seconds).',
	video_too_long: 'The video is longer than your plan allows.',
	no_audio_stream: 'The video has no audio.',
	no_video_stream: 'The file has no video track.',
};

/** 409 `error_code`s from POST /integrations/publications/batch. */
const SCHEDULING_CONFLICT_MESSAGES: Record<string, string> = {
	account_disconnected: `One of these social accounts is no longer connected to Klap. Reconnect it at ${CALENDAR_URL}.`,
	duplicate_post:
		'This clip is already scheduled on one of these platforms. A clip can be posted once per platform.',
	youtube_capacity: "Klap's YouTube posting capacity for that day is full. Choose another day.",
	publication_exists: 'This post is already scheduled.',
};

const PLAN_NAMES: Record<string, string> = {
	basic: 'Basic',
	pro: 'Pro',
	'pro-plus': 'Pro+',
	api: 'API',
};

export type KlapErrorDescription = { message: string; description?: string };

/**
 * The message users read for a failed Klap request.
 *
 * @param what What the request was about, for 404s (e.g. `project abc123`).
 */
export function describeKlapError(
	status: number | undefined,
	body: KlapErrorBody | undefined,
	what?: string,
): KlapErrorDescription {
	const code = body?.error_code;
	const serverMessage = body?.message ?? body?.error;
	const detail = code ? `Klap error code: ${code}` : serverMessage;

	if (status === 401) return { message: RECONNECT_MESSAGE };

	if (status === 402) {
		if (code === 'subscription_paused' || code === 'subscription_past_due') {
			const state = code === 'subscription_paused' ? 'paused' : 'past due';
			return {
				message: `Your Klap subscription is ${state}. Update it at ${BILLING_URL} to continue.`,
			};
		}
		const plan = body?.required_plan
			? ` (available on the ${PLAN_NAMES[body.required_plan] ?? body.required_plan} plan)`
			: '';
		return {
			message: `This isn't included in your current Klap plan${plan}. See plans at ${PRICING_URL}.`,
			description: detail,
		};
	}

	if (status === 422) {
		if (code) return { message: VIDEO_ERROR_MESSAGES[code] ?? code };
		return { message: serverMessage ?? "Klap couldn't process this request." };
	}

	// Some routes answer 400 "… not found" for something the user doesn't own.
	if (status === 404 || (status === 400 && /not found/i.test(serverMessage ?? ''))) {
		return { message: `Not found in your Klap account: ${what ?? 'the requested item'}.` };
	}

	if (status === 409) {
		const message = code ? SCHEDULING_CONFLICT_MESSAGES[code] : undefined;
		return {
			message: message ?? serverMessage ?? 'This conflicts with something already in Klap.',
			description: code ? `Klap error code: ${code}` : undefined,
		};
	}

	if (status === 429) {
		return {
			message: 'Klap is busy with too many requests from your account. Try again in a minute.',
			description: serverMessage,
		};
	}

	if (status !== undefined && status >= 500) {
		return { message: UNAVAILABLE_MESSAGE, description: serverMessage };
	}

	if (status !== undefined && status >= 400) {
		return {
			message: serverMessage
				? `Klap couldn't complete this request: ${serverMessage}`
				: `Klap couldn't complete this request (HTTP ${status}).`,
		};
	}

	return { message: UNAVAILABLE_MESSAGE };
}

type ErrorLike = {
	message?: string;
	httpCode?: string | null;
	statusCode?: number;
	status?: number;
	description?: string | null;
	context?: { data?: unknown };
	response?: { status?: number; data?: unknown; body?: unknown };
	cause?: unknown;
	failure?: { cause?: string };
	code?: string;
};

function asRecord(value: unknown): ErrorLike | undefined {
	return value !== null && typeof value === 'object' ? (value as ErrorLike) : undefined;
}

/** Response bodies can arrive parsed, as text, or as bytes (binary downloads). */
function parseBody(data: unknown): KlapErrorBody | undefined {
	if (data === null || data === undefined) return undefined;
	let value: unknown = data;
	if (value instanceof ArrayBuffer) value = Buffer.from(value);
	if (Buffer.isBuffer(value)) value = value.toString('utf8');
	if (typeof value === 'string') {
		const text = value;
		try {
			value = JSON.parse(text);
		} catch {
			return text ? { message: text } : undefined;
		}
	}
	return value !== null && typeof value === 'object' ? (value as KlapErrorBody) : undefined;
}

/** HTTP status and body of an error thrown by n8n's request helpers. */
export function extractHttpError(error: unknown): { status?: number; body?: KlapErrorBody } {
	const outer = asRecord(error);
	const cause = asRecord(outer?.cause);
	const statusCandidates = [
		outer?.response?.status,
		cause?.response?.status,
		outer?.httpCode ? Number(outer.httpCode) : undefined,
		outer?.statusCode,
		cause?.statusCode,
	];
	const status = statusCandidates.find(
		(candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate),
	);
	const body =
		parseBody(cause?.response?.data) ??
		parseBody(outer?.response?.data) ??
		parseBody(outer?.context?.data) ??
		parseBody(outer?.response?.body);
	return { status, body };
}

const RECONNECT_PATTERN =
	/needs to be reconnected|invalid_grant|refresh token|OAuth credentials not connected/i;

/**
 * n8n couldn't refresh the token: the refresh token was revoked, expired or
 * reused (client-oauth2 raises an `EAUTH` AuthError), or the credential was
 * never connected.
 */
function isReconnectError(error: unknown): boolean {
	const outer = asRecord(error);
	const cause = asRecord(outer?.cause);
	return [outer, cause].some(
		(record) =>
			record !== undefined &&
			(record.failure?.cause === 'credential-invalid' ||
				record.code === 'EAUTH' ||
				RECONNECT_PATTERN.test(record.message ?? '')),
	);
}

/**
 * Turns an error from n8n's request helpers into a NodeApiError users can act on.
 * Errors that aren't HTTP errors (validation, timeouts the node raises) pass through.
 */
export function toKlapError(
	node: INode,
	error: unknown,
	options: { itemIndex?: number; what?: string } = {},
): NodeApiError | NodeOperationError {
	if (error instanceof NodeOperationError) {
		if (isReconnectError(error)) {
			return new NodeOperationError(node, RECONNECT_MESSAGE, {
				itemIndex: options.itemIndex,
				description: error.message,
			});
		}
		return error;
	}

	const { status, body } = extractHttpError(error);
	if (status === undefined && isReconnectError(error)) {
		return new NodeOperationError(node, RECONNECT_MESSAGE, { itemIndex: options.itemIndex });
	}

	const { message, description } = describeKlapError(status, body, options.what);
	const errorResponse: JsonObject = {
		message,
		...(body ? { response: body as JsonObject } : {}),
	};
	// No HTTP response (network failure, timeout): keep what went wrong for debugging.
	const transportDetail = status === undefined ? asRecord(error)?.message : undefined;
	return new NodeApiError(node, errorResponse, {
		message,
		description: description ?? transportDetail,
		httpCode: status !== undefined ? String(status) : undefined,
		itemIndex: options.itemIndex,
	});
}

/** Errors leave the node as NodeApiError or NodeOperationError, tagged with the item. */
export function ensureNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (itemIndex !== undefined && error.context.itemIndex === undefined) {
			error.context.itemIndex = itemIndex;
		}
		return error;
	}
	return new NodeOperationError(node, error as Error, { itemIndex });
}
