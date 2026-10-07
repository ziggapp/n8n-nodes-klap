import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';

import { MAX_PROJECTS_PER_PAGE } from '../shared/constants';
import { accountLabel } from '../shared/schedule';
import { klapRequest, segment } from '../shared/transport';
import type { KlapClip, KlapSocialAccount, KlapTask } from '../shared/types';

/** How many recent ready projects the clip list covers when no project is chosen. */
const CLIP_LIST_PROJECTS = 5;

const matches = (label: string, filter?: string) =>
	!filter || label.toLowerCase().includes(filter.trim().toLowerCase());

export const projectLabel = (task: KlapTask) =>
	`${task.name} — ${task.status}, ${(task.created_at ?? '').slice(0, 10)}`;

export const clipLabel = (clip: KlapClip, rank: number) =>
	`#${rank} ${clip.name} (${clip.duration_seconds}s, score ${clip.virality_score ?? 'n/a'})`;

async function searchProjects(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const tasks = await klapRequest<KlapTask[]>(this, 'GET', '/tasks', {
		qs: { limit: MAX_PROJECTS_PER_PAGE },
	});
	const results: INodeListSearchItems[] = tasks
		.map((task) => ({ name: projectLabel(task), value: task.id, url: task.url ?? undefined }))
		.filter((item) => matches(item.name, filter));
	return { results };
}

async function searchClips(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const projectId = this.getCurrentNodeParameter('projectId', { extractValue: true }) as
		| string
		| undefined;

	let projects: KlapTask[];
	if (projectId) {
		projects = [await klapRequest<KlapTask>(this, 'GET', `/tasks/${segment(projectId)}`)];
	} else {
		// No project chosen: offer the clips of the most recent ready projects.
		const tasks = await klapRequest<KlapTask[]>(this, 'GET', '/tasks', {
			qs: { limit: MAX_PROJECTS_PER_PAGE },
		});
		projects = tasks.filter((task) => task.status === 'ready').slice(0, CLIP_LIST_PROJECTS);
	}

	const results: INodeListSearchItems[] = [];
	for (const project of projects) {
		if (project.status !== 'ready') continue;
		const clips = await klapRequest<KlapClip[]>(this, 'GET', `/tasks/${segment(project.id)}/clips`);
		clips.forEach((clip, index) => {
			const label = clipLabel(clip, index + 1);
			results.push({
				name: projectId ? label : `${project.name}: ${label}`,
				value: clip.id,
				url: clip.editor_url,
			});
		});
	}
	return { results: results.filter((item) => matches(item.name, filter)) };
}

async function getSocialAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const accounts = await klapRequest<KlapSocialAccount[]>(this, 'GET', '/integrations/accounts');
	return accounts.map((account) => ({
		name: accountLabel(account),
		value: account.id,
		description: account.needs_reconnect
			? 'Reconnect this account at https://klap.app/calendar before posting'
			: undefined,
	}));
}

export const listSearch = { searchProjects, searchClips };
export const loadOptions = { getSocialAccounts };
