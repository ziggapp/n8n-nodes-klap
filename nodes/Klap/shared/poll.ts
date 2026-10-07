import { toClips, toProject } from './normalize';
import type { ClipOutput, KlapClip, KlapTask, ProjectOutput } from './types';

export type TriggerEvent = 'projectReady' | 'newClip' | 'projectFailed';

/** What a poll may call; the trigger wires it to Klap's API. */
export type PollClient = {
	/** GET /tasks?limit=50: newest first. */
	listProjects(): Promise<KlapTask[]>;
	/** GET /tasks/{id}/clips: best first. */
	listClips(projectId: string): Promise<KlapClip[]>;
};

/** Persisted in the workflow's static data (scope `node`). */
export type PollState = {
	event?: string;
	/** Project Ready / Project Failed: projects already announced. New Clip: projects whose clips were handled. */
	seenProjectIds?: string[];
	/** New Clip: clips already announced. */
	seenClipIds?: string[];
};

export type PollOptions = {
	event: TriggerEvent;
	/** Manual run in the editor: return the most recent real item(s), don't touch the state. */
	manual: boolean;
	minViralityScore?: number;
	/** Only the best N clips of each project; 0 or unset means all. */
	clipsPerProject?: number;
};

/** Projects enriched with their clips per poll, at most (≤ 1 + 10 requests). */
export const MAX_ENRICHED_PROJECTS = 10;
/** New Clip looks at this many most recent ready projects. */
export const NEW_CLIP_PROJECT_WINDOW = 10;
/** Manual runs of New Clip look at this many ready projects for a sample. */
const SAMPLE_PROJECTS = 3;
/** Ids kept for deduplication, per list. */
const MAX_REMEMBERED_IDS = 1000;

export class NoSampleError extends Error {}

const remember = (ids: string[] | undefined, added: string[]) =>
	[...(ids ?? []), ...added].slice(-MAX_REMEMBERED_IDS);

function selectClips(
	clips: KlapClip[],
	project: KlapTask,
	options: Pick<PollOptions, 'minViralityScore' | 'clipsPerProject'>,
): ClipOutput[] {
	const best =
		options.clipsPerProject && options.clipsPerProject > 0 ? options.clipsPerProject : Infinity;
	const minScore = options.minViralityScore ?? 0;
	return toClips(clips, project)
		.slice(0, best)
		.filter((clip) => minScore <= 0 || (clip.virality_score ?? 0) >= minScore);
}

async function sample(
	client: PollClient,
	tasks: KlapTask[],
	options: PollOptions,
): Promise<Array<ProjectOutput | ClipOutput>> {
	if (options.event === 'projectFailed') {
		const failed = tasks.find((task) => task.status === 'error');
		if (!failed) throw new NoSampleError('No failed projects in your Klap account yet');
		return [toProject(failed)];
	}

	const ready = tasks.filter((task) => task.status === 'ready');
	if (options.event === 'projectReady') {
		if (!ready.length) throw new NoSampleError('No ready projects in your Klap account yet');
		return [toProject(ready[0], await client.listClips(ready[0].id))];
	}

	for (const project of ready.slice(0, SAMPLE_PROJECTS)) {
		const clips = selectClips(await client.listClips(project.id), project, options);
		if (clips.length) return clips;
	}
	throw new NoSampleError(
		ready.length
			? 'No clips in your recent Klap projects match these options'
			: 'No ready projects in your Klap account yet',
	);
}

/**
 * One poll of the Klap Trigger. Returns what to emit (newest first) and
 * updates `state`. The first poll after activation (or after the event
 * changes) only records what exists, so history never fires.
 */
export async function pollKlap(
	client: PollClient,
	state: PollState,
	options: PollOptions,
): Promise<Array<ProjectOutput | ClipOutput>> {
	const tasks = await client.listProjects();
	if (options.manual) return await sample(client, tasks, options);

	const seeding = state.event !== options.event || !Array.isArray(state.seenProjectIds);
	const seen = new Set(seeding ? [] : state.seenProjectIds);
	const output: Array<ProjectOutput | ClipOutput> = [];
	const newProjectIds: string[] = [];

	if (options.event === 'projectFailed') {
		const failed = tasks.filter((task) => task.status === 'error');
		for (const task of failed) {
			if (seen.has(task.id)) continue;
			newProjectIds.push(task.id);
			if (!seeding) output.push(toProject(task));
		}
		state.event = options.event;
		state.seenProjectIds = remember(seeding ? [] : state.seenProjectIds, newProjectIds);
		return output;
	}

	if (options.event === 'projectReady') {
		const ready = tasks.filter((task) => task.status === 'ready' && !seen.has(task.id));
		if (seeding) {
			newProjectIds.push(...ready.map((task) => task.id));
		} else {
			// Newest first; projects past the cap stay unseen and go out on the next poll.
			for (const task of ready.slice(0, MAX_ENRICHED_PROJECTS)) {
				output.push(toProject(task, await client.listClips(task.id)));
				newProjectIds.push(task.id);
			}
		}
		state.event = options.event;
		state.seenProjectIds = remember(seeding ? [] : state.seenProjectIds, newProjectIds);
		return output;
	}

	// New Clip: clips of the most recent ready projects not handled yet.
	const recent = tasks
		.filter((task) => task.status === 'ready')
		.slice(0, NEW_CLIP_PROJECT_WINDOW)
		.filter((task) => !seen.has(task.id));
	const seenClips = new Set(seeding ? [] : state.seenClipIds);
	const newClipIds: string[] = [];
	for (const task of recent) {
		if (seeding) {
			newProjectIds.push(task.id);
			continue;
		}
		const clips = await client.listClips(task.id);
		// A ready project without clips yet is looked at again on the next poll.
		if (!clips.length) continue;
		newProjectIds.push(task.id);
		for (const clip of selectClips(clips, task, options)) {
			if (seenClips.has(clip.id)) continue;
			seenClips.add(clip.id);
			newClipIds.push(clip.id);
			output.push(clip);
		}
	}
	state.event = options.event;
	state.seenProjectIds = remember(seeding ? [] : state.seenProjectIds, newProjectIds);
	state.seenClipIds = remember(seeding ? [] : state.seenClipIds, newClipIds);
	return output;
}
