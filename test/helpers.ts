import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const testNode: INode = {
	id: 'node-1',
	name: 'Klap',
	type: 'n8n-nodes-klap.klap',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export type Call = { authenticated: boolean; request: IHttpRequestOptions };

/** Answers a request like Klap would, or throws an `HttpError`. */
export type Router = (request: IHttpRequestOptions) => unknown;

/** An HTTP failure as n8n's request helpers report it (NodeApiError wrapping an axios-like error). */
export function httpError(status: number, data: unknown): NodeApiError {
	const axiosLike = Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data },
	});
	return new NodeApiError(testNode, axiosLike as never);
}

export const path = (request: IHttpRequestOptions) => new URL(request.url).pathname;

type Params = Record<string, unknown>;

function lookup(params: Params, name: string): unknown {
	if (name in params) return params[name];
	// "additionalFields.timeZone" style lookups
	return name.split('.').reduce<unknown>((value, key) => {
		if (value && typeof value === 'object') return (value as IDataObject)[key];
		return undefined;
	}, params);
}

export function createExecuteContext(options: {
	params: Params;
	router: Router;
	items?: INodeExecutionData[];
	continueOnFail?: boolean;
	binaryStreams?: Record<string, { content: Buffer; fileSize: number }>;
}) {
	const calls: Call[] = [];
	const items = options.items ?? [{ json: {} }];

	const context = {
		getInputData: () => items,
		getNode: () => testNode,
		continueOnFail: () => options.continueOnFail ?? false,
		getExecutionCancelSignal: () => undefined,
		getNodeParameter: (
			name: string,
			_itemIndex: number,
			fallback?: unknown,
			parameterOptions?: { extractValue?: boolean },
		) => {
			const value = lookup(options.params, name);
			if (value === undefined) return fallback;
			if (
				parameterOptions?.extractValue &&
				value &&
				typeof value === 'object' &&
				'__rl' in (value as IDataObject)
			) {
				return (value as IDataObject).value;
			}
			return value;
		},
		helpers: {
			httpRequestWithAuthentication: async (_type: string, request: IHttpRequestOptions) => {
				calls.push({ authenticated: true, request });
				return options.router(request);
			},
			httpRequest: async (request: IHttpRequestOptions) => {
				calls.push({ authenticated: false, request });
				return options.router(request);
			},
			assertBinaryData: (itemIndex: number, propertyName: string): IBinaryData => {
				const binary = items[itemIndex]?.binary?.[propertyName];
				if (!binary) throw new Error(`No binary data in "${propertyName}"`);
				return binary;
			},
			getBinaryMetadata: async (id: string) => ({
				fileSize: options.binaryStreams?.[id]?.fileSize ?? 0,
			}),
			// Stands in for the Readable n8n returns; the code under test only passes it on.
			getBinaryStream: async (id: string) => ({
				streamOf: id,
				content: options.binaryStreams?.[id]?.content,
			}),
			prepareBinaryData: async (
				data: Buffer,
				fileName?: string,
				mimeType?: string,
			): Promise<IBinaryData> => ({
				data: data.toString('base64'),
				fileName,
				mimeType: mimeType ?? 'application/octet-stream',
			}),
			returnJsonArray: (data: IDataObject[]) => data.map((json) => ({ json })),
		},
	};

	return { context: context as unknown as IExecuteFunctions, calls };
}

export function createPollContext(options: {
	params: Params;
	router: Router;
	mode?: 'manual' | 'trigger';
	staticData?: IDataObject;
}) {
	const calls: Call[] = [];
	const staticData = options.staticData ?? {};
	const context = {
		getNode: () => ({ ...testNode, name: 'Klap Trigger', type: 'n8n-nodes-klap.klapTrigger' }),
		getMode: () => options.mode ?? 'trigger',
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in options.params ? options.params[name] : fallback,
		helpers: {
			httpRequestWithAuthentication: async (_type: string, request: IHttpRequestOptions) => {
				calls.push({ authenticated: true, request });
				return options.router(request);
			},
			returnJsonArray: (data: IDataObject[]) => data.map((json) => ({ json })),
		},
	};
	return { context: context as unknown as IPollFunctions, calls, staticData };
}

/** A resource locator value as n8n stores it. */
export const rl = (value: string, mode = 'id') => ({ __rl: true, mode, value });

export const task = (overrides: Partial<Record<string, unknown>> = {}) => ({
	id: 'p1AbCdEfGhIjKlMn',
	status: 'ready',
	error_code: null,
	name: 'My podcast ep. 12',
	source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
	thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
	created_at: '2026-10-07T12:00:00.000Z',
	estimated_ready_at: '2026-10-07T12:12:00.000Z',
	folder_id: 'fold1234',
	url: 'https://klap.app/spaces/fold1234',
	...overrides,
});

export const clip = (
	id: string,
	score: number | null,
	overrides: Partial<Record<string, unknown>> = {},
) => ({
	id,
	name: `Clip ${id}`,
	virality_score: score,
	virality_score_explanation: 'Strong hook',
	duration_seconds: 42,
	width: 1080,
	height: 1920,
	thumbnail_url: `https://api.klap.app/projects/${id}/thumbnail`,
	embed_url: `https://klap.app/embed/${id}`,
	editor_url: `https://klap.app/editor/${id}`,
	created_at: '2026-10-07T12:11:30.000Z',
	...overrides,
});
