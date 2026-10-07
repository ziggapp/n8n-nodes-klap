import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
} from 'n8n-workflow';

import { API_URL, CREDENTIAL_TYPE } from './constants';
import { toKlapError } from './errors';

export type KlapContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export type KlapRequestOptions = {
	body?: IDataObject;
	qs?: IDataObject;
	/** What the request is about, for "Not found in your Klap account: …". */
	what?: string;
	itemIndex?: number;
	timeout?: number;
};

/**
 * Calls Klap's API with the user's OAuth token. n8n refreshes the token on a
 * 401 and retries once; errors are mapped to the messages users read.
 */
export async function klapRequest<T>(
	context: KlapContext,
	method: IHttpRequestMethods,
	path: string,
	options: KlapRequestOptions = {},
): Promise<T> {
	const request: IHttpRequestOptions = {
		method,
		url: `${API_URL}${path}`,
		headers: { Accept: 'application/json' },
		json: true,
	};
	if (options.body !== undefined) request.body = options.body;
	if (options.qs !== undefined) request.qs = options.qs;
	if (options.timeout !== undefined) request.timeout = options.timeout;

	try {
		return (await context.helpers.httpRequestWithAuthentication.call(
			context,
			CREDENTIAL_TYPE,
			request,
		)) as T;
	} catch (error) {
		throw toKlapError(context.getNode(), error, {
			itemIndex: options.itemIndex,
			what: options.what,
		});
	}
}

/** Downloads a binary response (the rendered MP4) with the user's OAuth token. */
export async function klapDownload(
	context: IExecuteFunctions,
	path: string,
	options: KlapRequestOptions = {},
): Promise<{ body: Buffer; headers: IDataObject }> {
	const request: IHttpRequestOptions = {
		method: 'GET',
		url: `${API_URL}${path}`,
		encoding: 'arraybuffer',
		json: false,
		returnFullResponse: true,
	};
	if (options.qs !== undefined) request.qs = options.qs;
	if (options.timeout !== undefined) request.timeout = options.timeout;

	try {
		const response = (await context.helpers.httpRequestWithAuthentication.call(
			context,
			CREDENTIAL_TYPE,
			request,
		)) as { body: Buffer | ArrayBuffer; headers?: IDataObject };
		const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
		return { body, headers: response.headers ?? {} };
	} catch (error) {
		throw toKlapError(context.getNode(), error, {
			itemIndex: options.itemIndex,
			what: options.what,
		});
	}
}

/** Path segment for an id. */
export const segment = (value: string) => encodeURIComponent(value);
