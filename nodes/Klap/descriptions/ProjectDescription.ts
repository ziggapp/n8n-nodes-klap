import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_CLIPS_TIMEOUT_MINUTES, MAX_PROJECTS_PER_PAGE } from '../shared/constants';
import { projectLocator, returnAllAndLimit } from './common';

const LANGUAGES: Array<[string, string]> = [
	['Arabic', 'ar'],
	['Chinese', 'zh'],
	['Dutch', 'nl'],
	['English', 'en'],
	['French', 'fr'],
	['German', 'de'],
	['Hindi', 'hi'],
	['Indonesian', 'id'],
	['Italian', 'it'],
	['Japanese', 'ja'],
	['Korean', 'ko'],
	['Polish', 'pl'],
	['Portuguese', 'pt'],
	['Russian', 'ru'],
	['Spanish', 'es'],
	['Swedish', 'sv'],
	['Turkish', 'tr'],
	['Ukrainian', 'uk'],
	['Vietnamese', 'vi'],
];

export const projectOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['project'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Clip a long video into short clips. Creates a project.',
				action: 'Create clips from a video',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project and, once it is ready, its clips',
				action: 'Get a project',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many of your most recent projects, newest first (up to 50)',
				action: 'Get many projects',
			},
		],
		default: 'create',
	},
];

const create = { resource: ['project'], operation: ['create'] };

export const projectFields: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                               project:create                               */
	/* -------------------------------------------------------------------------- */
	{
		displayName:
			'Clipping takes several minutes. This returns the project right away with status "processing". To get its clips, use the Klap Trigger (Project Ready or New Clip) or Project → Get.',
		name: 'createNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { ...create, waitForClips: [false] } },
	},
	{
		displayName: 'Video Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'URL',
				value: 'url',
				description: 'A link to the video',
			},
			{
				name: 'Binary File',
				value: 'binary',
				description: 'A video file from a previous node (MP4, MOV or WebM)',
			},
		],
		default: 'url',
		description: 'Where the video comes from',
		displayOptions: { show: create },
	},
	{
		displayName: 'Video URL',
		name: 'videoUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		description:
			'Link to the video: YouTube, Google Drive, Dropbox, Vimeo, Twitch, Loom, or a direct link to a video file',
		displayOptions: { show: { ...create, source: ['url'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		placeholder: 'e.g. data',
		hint: 'The name of the input binary field containing the video (MP4, MOV or WebM)',
		description: 'Klap uploads this file, then clips it. Videos can be up to 4 hours long.',
		displayOptions: { show: { ...create, source: ['binary'] } },
	},
	{
		displayName: 'Wait for Clips',
		name: 'waitForClips',
		type: 'boolean',
		default: true,
		description: 'Whether to wait until Klap has made the clips, usually 5 to 15 minutes, then output one item per clip, best first. Each clip has a preview_url to watch or embed it; add Clip → Export for an MP4. Turn off to get the project right away with status "processing".',
		displayOptions: { show: { ...create, '@version': [{ _cnd: { gte: 1.1 } }] } },
	},
	{
		// Version 1 returned the project right away: keep that default for existing workflows.
		displayName: 'Wait for Clips',
		name: 'waitForClips',
		type: 'boolean',
		default: false,
		description: 'Whether to wait until Klap has made the clips, usually 5 to 15 minutes, then output one item per clip, best first. Each clip has a preview_url to watch or embed it; add Clip → Export for an MP4. Turn off to get the project right away with status "processing".',
		displayOptions: { show: { ...create, '@version': [1] } },
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'waitTimeoutMinutes',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: DEFAULT_CLIPS_TIMEOUT_MINUTES,
		description:
			'How long to wait for the clips. If Klap is still clipping by then, the node fails with the project ID, and the project keeps going in Klap.',
		displayOptions: { show: { ...create, waitForClips: [true] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: create },
		options: [
			{
				displayName: 'Aspect Ratio',
				name: 'aspectRatio',
				type: 'options',
				options: [
					{ name: '1:1 Square (1080×1080)', value: '1:1' },
					{ name: '16:9 Landscape (1920×1080)', value: '16:9' },
					{ name: '4:5 Portrait (1080×1350)', value: '4:5' },
					{ name: '9:16 Vertical (1080×1920)', value: '9:16' },
				],
				default: '9:16',
				description: 'Shape of the clips. Vertical 9:16 suits TikTok, Reels and YouTube Shorts.',
			},
			{
				displayName: 'Clip Length',
				name: 'clipLength',
				type: 'options',
				options: [
					{ name: 'Auto (About 60 Seconds)', value: '0' },
					{ name: 'About 15 Seconds', value: '15' },
					{ name: 'About 30 Seconds', value: '30' },
					{ name: 'About 45 Seconds', value: '45' },
					{ name: 'About 60 Seconds', value: '60' },
					{ name: 'About 90 Seconds', value: '90' },
					{ name: 'About 120 Seconds', value: '120' },
				],
				default: '0',
				description: 'Target length of each clip, e.g. About 30 Seconds',
			},
			{
				displayName: 'Instructions',
				name: 'instructions',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'e.g. the funniest moments, or every tip about pricing',
				description:
					'What should Klap look for? For example: the funniest moments, or every tip about pricing. Up to 1,000 characters.',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				options: [
					{ name: 'Auto-Detect', value: '' },
					...LANGUAGES.map(([name, value]) => ({ name, value })),
				],
				default: '',
				description:
					'Spoken language of the video. Auto-detect works for most videos. To use another language, set an expression with its ISO 639-1 code, e.g. el.',
			},
			{
				displayName: 'Max Number of Clips',
				name: 'maxClipCount',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 60 },
				default: 10,
				description:
					'Upper bound on the number of clips, from 1 to 60. Leave this field out to let Klap decide from the video length.',
			},
			{
				displayName: 'Project Name',
				name: 'projectName',
				type: 'string',
				default: '',
				placeholder: 'e.g. Podcast episode 12',
				description:
					'Name of the project in Klap. Used for direct links and uploaded files; YouTube and other platforms keep their video title.',
			},
		],
	},

	/* -------------------------------------------------------------------------- */
	/*                                 project:get                                */
	/* -------------------------------------------------------------------------- */
	projectLocator(
		{ show: { resource: ['project'], operation: ['get'] } },
		{ required: true, description: 'The project to get' },
	),

	/* -------------------------------------------------------------------------- */
	/*                               project:getAll                               */
	/* -------------------------------------------------------------------------- */
	...returnAllAndLimit(
		{ show: { resource: ['project'], operation: ['getAll'] } },
		MAX_PROJECTS_PER_PAGE,
	),
];
