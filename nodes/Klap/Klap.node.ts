import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import * as clip from './actions/clip';
import * as exportActions from './actions/export';
import * as project from './actions/project';
import * as socialAccount from './actions/socialAccount';
import { clipFields, clipOperations } from './descriptions/ClipDescription';
import { exportFields, exportOperations } from './descriptions/ExportDescription';
import { projectFields, projectOperations } from './descriptions/ProjectDescription';
import {
	socialAccountFields,
	socialAccountOperations,
} from './descriptions/SocialAccountDescription';
import { listSearch, loadOptions } from './methods';
import { CREDENTIAL_TYPE } from './shared/constants';
import { ensureNodeError } from './shared/errors';

type Operation = (this: IExecuteFunctions, i: number) => Promise<INodeExecutionData[]>;

const OPERATIONS: Record<string, Record<string, Operation>> = {
	project: { create: project.create, get: project.get, getAll: project.getAll },
	clip: {
		getAll: clip.getAll,
		export: clip.exportClip,
		schedule: clip.schedule,
		writeCaption: clip.writeCaption,
	},
	export: { get: exportActions.get },
	socialAccount: { getAll: socialAccount.getAll },
};

export class Klap implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Klap',
		name: 'klap',
		icon: { light: 'file:../../icons/klap.svg', dark: 'file:../../icons/klap.dark.svg' },
		group: ['transform'],
		version: [1, 1.1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Turn long videos into viral short clips with Klap, then export them or post them to social media',
		defaults: {
			name: 'Klap',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL_TYPE,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Clip', value: 'clip' },
					{ name: 'Export', value: 'export' },
					{ name: 'Project', value: 'project' },
					{ name: 'Social Account', value: 'socialAccount' },
				],
				default: 'project',
			},
			...projectOperations,
			...projectFields,
			...clipOperations,
			...clipFields,
			...exportOperations,
			...exportFields,
			...socialAccountOperations,
			...socialAccountFields,
		],
	};

	methods = { listSearch, loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const run = OPERATIONS[resource]?.[operation];
				if (!run) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" isn't supported for "${resource}"`,
						{ itemIndex: i },
					);
				}
				const results = await run.call(this, i);
				for (const result of results) {
					returnData.push({ ...result, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw ensureNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
