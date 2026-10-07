import type { INodeProperties } from 'n8n-workflow';

import { clipLocator, clipProjectDescription, projectLocator } from './common';

export const exportOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['export'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get the status and video URL of an export',
				action: 'Get an export',
			},
		],
		default: 'get',
	},
];

const get = { resource: ['export'], operation: ['get'] };

export const exportFields: INodeProperties[] = [
	projectLocator({ show: get }, { required: false, description: clipProjectDescription }),
	clipLocator({ show: get }),
	{
		displayName: 'Export ID',
		name: 'exportId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 9b2f6a4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b',
		description: 'The export ID, from the output of Clip → Export',
		displayOptions: { show: get },
	},
];
