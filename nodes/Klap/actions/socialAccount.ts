import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { toSocialAccount } from '../shared/normalize';
import { klapRequest } from '../shared/transport';
import type { KlapSocialAccount } from '../shared/types';

export async function getAll(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
	const accounts = await klapRequest<KlapSocialAccount[]>(this, 'GET', '/integrations/accounts', {
		itemIndex: i,
	});
	return accounts.slice(0, limit).map((account) => ({ json: toSocialAccount(account) }));
}
