import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { toExport } from '../shared/normalize';
import { klapRequest, segment } from '../shared/transport';
import type { KlapExport } from '../shared/types';

export async function get(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const clipId = this.getNodeParameter('clipId', i, '', { extractValue: true }) as string;
	const exportId = (this.getNodeParameter('exportId', i) as string).trim();
	const record = await klapRequest<KlapExport>(
		this,
		'GET',
		`/projects/${segment(clipId)}/exports/${segment(exportId)}`,
		{ itemIndex: i, what: `export ${exportId} of clip ${clipId}` },
	);
	return [{ json: toExport(record, clipId) }];
}
