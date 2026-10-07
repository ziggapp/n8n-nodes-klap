import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

export function projectLocator(
	displayOptions: IDisplayOptions,
	options: { required: boolean; description: string },
): INodeProperties {
	return {
		displayName: 'Project',
		name: 'projectId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		...(options.required ? { required: true } : {}),
		description: options.description,
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a project...',
				typeOptions: {
					searchListMethod: 'searchProjects',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 4kXq9ZpL2mN7rT1v',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z0-9_-]+$',
							errorMessage: 'Not a valid Klap project ID',
						},
					},
				],
			},
		],
	};
}

export function clipLocator(displayOptions: IDisplayOptions): INodeProperties {
	return {
		displayName: 'Clip',
		name: 'clipId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description:
			'The clip. The list shows the clips of the project above, or of your most recent projects when no project is chosen.',
		displayOptions,
		typeOptions: {
			loadOptionsDependsOn: ['projectId.value'],
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a clip...',
				typeOptions: {
					searchListMethod: 'searchClips',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. Xb7pQ2sLk9Wd',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z0-9_-]+$',
							errorMessage: 'Not a valid Klap clip ID',
						},
					},
				],
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				placeholder: 'e.g. https://klap.app/editor/Xb7pQ2sLk9Wd',
				extractValue: {
					type: 'regex',
					regex: 'https:\\/\\/klap\\.app\\/(?:editor|embed)\\/([A-Za-z0-9_-]+)',
				},
				validation: [
					{
						type: 'regex',
						properties: {
							regex: 'https:\\/\\/klap\\.app\\/(?:editor|embed)\\/([A-Za-z0-9_-]+)(?:.*)',
							errorMessage: 'Not a Klap clip URL (https://klap.app/editor/…)',
						},
					},
				],
			},
		],
	};
}

/** The optional project picker shown above a Clip picker. */
export const clipProjectDescription =
	'Only used to list its clips below. Not needed when you enter a clip ID or URL.';

export function returnAllAndLimit(
	displayOptions: IDisplayOptions,
	maxValue?: number,
): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions,
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: {
				minValue: 1,
				...(maxValue ? { maxValue } : {}),
			},
			description: 'Max number of results to return',
			displayOptions: {
				...displayOptions,
				show: { ...displayOptions.show, returnAll: [false] },
			},
		},
	];
}
