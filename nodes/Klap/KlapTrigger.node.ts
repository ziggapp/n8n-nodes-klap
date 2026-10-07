import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CREDENTIAL_TYPE, MAX_PROJECTS_PER_PAGE } from './shared/constants';
import { ensureNodeError } from './shared/errors';
import type { PollClient, PollState, TriggerEvent } from './shared/poll';
import { NoSampleError, pollKlap } from './shared/poll';
import { klapRequest, segment } from './shared/transport';
import type { KlapClip, KlapTask } from './shared/types';

export class KlapTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Klap Trigger',
		name: 'klapTrigger',
		icon: { light: 'file:../../icons/klap.svg', dark: 'file:../../icons/klap.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when Klap finishes clipping a video',
		defaults: {
			name: 'Klap Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL_TYPE,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New Clip',
						value: 'newClip',
						description:
							'Once per clip when a project is ready. Looks at your 10 most recent ready projects.',
					},
					{
						name: 'Project Failed',
						value: 'projectFailed',
						description: "When Klap couldn't clip a video, with the reason",
					},
					{
						name: 'Project Ready',
						value: 'projectReady',
						description: 'When a project finishes, with all its clips, best first',
					},
				],
				default: 'projectReady',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { event: ['newClip'] } },
				options: [
					{
						displayName: 'Minimum Virality Score',
						name: 'minViralityScore',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 100 },
						default: 0,
						description: 'Only fire for clips scoring at least this much, from 0 to 100, e.g. 70',
					},
					{
						displayName: 'Only the Best N Clips per Project',
						name: 'clipsPerProject',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 0,
						description:
							'Only fire for the N best clips of each project, by virality score, e.g. 3. 0 fires for every clip.',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as TriggerEvent;
		const options = this.getNodeParameter('options', {}) as {
			minViralityScore?: number;
			clipsPerProject?: number;
		};
		const manual = this.getMode() === 'manual';

		const client: PollClient = {
			listProjects: async () =>
				await klapRequest<KlapTask[]>(this, 'GET', '/tasks', {
					qs: { limit: MAX_PROJECTS_PER_PAGE },
				}),
			listClips: async (projectId: string) =>
				await klapRequest<KlapClip[]>(this, 'GET', `/tasks/${segment(projectId)}/clips`, {
					what: `project ${projectId}`,
				}),
		};

		// Manual runs work on a copy: only an active workflow records what it has seen.
		const staticData = this.getWorkflowStaticData('node') as PollState & IDataObject;
		const state: PollState = manual ? {} : staticData;

		let results: IDataObject[];
		try {
			results = (await pollKlap(client, state, {
				event,
				manual,
				minViralityScore: options.minViralityScore,
				clipsPerProject: options.clipsPerProject,
			})) as unknown as IDataObject[];
		} catch (error) {
			if (error instanceof NoSampleError) {
				throw new NodeOperationError(this.getNode(), error.message, {
					description:
						'This trigger shows your most recent real item when you test it. Create clips in Klap (or with the Klap node) first, then try again.',
				});
			}
			throw ensureNodeError(this.getNode(), error);
		}

		if (!results.length) return null;
		return [this.helpers.returnJsonArray(results)];
	}
}
