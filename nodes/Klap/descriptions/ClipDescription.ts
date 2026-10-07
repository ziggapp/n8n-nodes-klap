import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_EXPORT_TIMEOUT_MINUTES } from '../shared/constants';
import { clipLocator, clipProjectDescription, projectLocator, returnAllAndLimit } from './common';

export const clipOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['clip'] } },
		options: [
			{
				name: 'Export',
				value: 'export',
				description: 'Render a clip to an MP4 file',
				action: 'Export a clip',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many clips of a project, best first',
				action: 'Get many clips',
			},
			{
				name: 'Schedule',
				value: 'schedule',
				description: 'Post a clip to social media now or later',
				action: 'Schedule a clip',
			},
			{
				name: 'Write Caption',
				value: 'writeCaption',
				description: 'Write a social media caption for a clip with AI',
				action: 'Write a caption for a clip',
			},
		],
		default: 'getAll',
	},
];

const getAll = { resource: ['clip'], operation: ['getAll'] };
const exportOp = { resource: ['clip'], operation: ['export'] };
const schedule = { resource: ['clip'], operation: ['schedule'] };
const writeCaption = { resource: ['clip'], operation: ['writeCaption'] };
const actsOnClip = { resource: ['clip'], operation: ['export', 'schedule', 'writeCaption'] };

export const clipFields: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                                 clip:getAll                                */
	/* -------------------------------------------------------------------------- */
	projectLocator(
		{ show: getAll },
		{
			required: true,
			description: 'The project whose clips to get. Clips exist once the project is ready.',
		},
	),
	...returnAllAndLimit({ show: getAll }),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: getAll },
		options: [
			{
				displayName: 'Minimum Virality Score',
				name: 'minViralityScore',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 100 },
				default: 0,
				description: 'Only return clips scoring at least this much, from 0 to 100, e.g. 70',
			},
		],
	},

	/* -------------------------------------------------------------------------- */
	/*                    clip:export, clip:schedule, writeCaption                */
	/* -------------------------------------------------------------------------- */
	projectLocator({ show: actsOnClip }, { required: false, description: clipProjectDescription }),
	clipLocator({ show: actsOnClip }),

	/* -------------------------------------------------------------------------- */
	/*                                 clip:export                                */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Wait for Export',
		name: 'waitForExport',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until the MP4 is ready (rendering takes about as long as the clip). If off, the export is returned with status "processing"; use Export → Get to check on it.',
		displayOptions: { show: exportOp },
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 60 },
		default: DEFAULT_EXPORT_TIMEOUT_MINUTES,
		description: 'How long to wait for the MP4 before the node stops with an error',
		displayOptions: { show: { ...exportOp, waitForExport: [true] } },
	},
	{
		displayName: 'Download Video',
		name: 'download',
		type: 'boolean',
		default: false,
		description: 'Whether to add the MP4 file to the output as binary data',
		displayOptions: { show: { ...exportOp, waitForExport: [true] } },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		placeholder: 'e.g. data',
		hint: 'The name of the output binary field to put the MP4 in',
		displayOptions: { show: { ...exportOp, waitForExport: [true], download: [true] } },
	},

	/* -------------------------------------------------------------------------- */
	/*                                clip:schedule                               */
	/* -------------------------------------------------------------------------- */
	{
		displayName:
			'Connect social accounts in Klap first: <a href="https://klap.app/calendar" target="_blank">klap.app/calendar</a>',
		name: 'scheduleNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: schedule },
	},
	{
		displayName: 'Social Account Names or IDs',
		name: 'accountIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getSocialAccounts' },
		required: true,
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: schedule },
	},
	{
		displayName: 'Publish At',
		name: 'publishAt',
		type: 'dateTime',
		default: '',
		description:
			'When to post. Leave empty to post now (within a couple of minutes). A time without an offset is read in the Time Zone below (UTC by default).',
		displayOptions: { show: schedule },
	},
	{
		displayName: 'Caption',
		name: 'caption',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		placeholder: 'e.g. Why most startups fail #startup #founder',
		description:
			'Post text, up to 2,200 characters. Leave empty and Klap writes one with AI. Also the YouTube title unless you set one.',
		displayOptions: { show: schedule },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: schedule },
		options: [
			{
				displayName: 'TikTok Privacy',
				name: 'tiktokPrivacyLevel',
				type: 'options',
				options: [
					{ name: 'Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Followers', value: 'FOLLOWER_OF_CREATOR' },
					{ name: 'Friends (Mutual Followers)', value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Only Me', value: 'SELF_ONLY' },
				],
				default: 'PUBLIC_TO_EVERYONE',
				description: 'Who can see the TikTok post. Required when posting to TikTok.',
			},
			{
				displayName: 'Time Zone',
				name: 'timeZone',
				type: 'string',
				default: 'UTC',
				placeholder: 'e.g. Europe/Paris',
				description:
					'IANA time zone used to read a Publish At time that has no offset, e.g. America/New_York',
			},
			{
				displayName: 'YouTube Title',
				name: 'youtubeTitle',
				type: 'string',
				default: '',
				placeholder: 'e.g. Why most startups fail',
				description:
					"Title of the YouTube Short, up to 100 characters. Defaults to the caption's first 100 characters.",
			},
		],
	},

	/* -------------------------------------------------------------------------- */
	/*                              clip:writeCaption                             */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Tone',
		name: 'tone',
		type: 'options',
		options: [
			{ name: 'Casual', value: 'casual' },
			{ name: 'Educational', value: 'educational' },
			{ name: 'Funny', value: 'funny' },
			{ name: 'Inspirational', value: 'inspirational' },
			{ name: 'Professional', value: 'professional' },
		],
		default: 'casual',
		description: 'Tone of the caption',
		displayOptions: { show: writeCaption },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: writeCaption },
		options: [
			{
				displayName: 'Instructions',
				name: 'instructions',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'e.g. Mention our free trial and end with a question',
				description: 'What the caption should say or do, up to 1,000 characters',
			},
		],
	},
];
