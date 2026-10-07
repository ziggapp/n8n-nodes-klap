import type { INodeProperties } from 'n8n-workflow';

import { returnAllAndLimit } from './common';

export const socialAccountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['socialAccount'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many of the social accounts connected to Klap',
				action: 'Get many social accounts',
			},
		],
		default: 'getAll',
	},
];

export const socialAccountFields: INodeProperties[] = [
	...returnAllAndLimit({ show: { resource: ['socialAccount'], operation: ['getAll'] } }),
];
