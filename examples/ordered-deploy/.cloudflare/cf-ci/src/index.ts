import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep, Charm } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};
type Check = { exitCode: number | null; log: string; skipped?: true };
type JobStep = { name: string; command: string; outputs?: Record<string, string> };

// The backend builds and deploys before the frontend, in the comparison job's order.
const STEPS: JobStep[] = [
	{ name: 'npm install', command: 'npm install', outputs: { modules: 'repo/node_modules' } },
	{ name: 'build backend', command: 'cd apps/backend && npx cf build --mode production', outputs: { backend: 'repo/apps/backend/.cloudflare/output' } },
	{ name: 'build frontend', command: 'cd apps/frontend && npx cf build --mode production', outputs: { frontend: 'repo/apps/frontend/.cloudflare/output' } },
	{ name: 'deploy backend', command: 'cd apps/backend && npx cf deploy --prebuilt --mode production --dry-run' },
	{ name: 'deploy frontend', command: 'cd apps/frontend && npx cf deploy --prebuilt --mode production --dry-run' },
];

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };

export class CI extends WorkflowEntrypoint<Env> {
	async run(event: WorkflowEvent<PushEvent>, workflowStep: WorkflowStep) {
		const step = workflowStep as InternalWorkflowStep;
		const { repoName } = event.payload.source;
		const commit = event.payload.payload.after;

		// The read token reaches the checkout through `env`, which step.runner() does not treat as secret.
		const repo = await step.do('get clone token', async () => {
			using artifactsRepo = await this.env.ARTIFACTS.get(repoName);
			const [info, token] = await Promise.all([artifactsRepo.info(), artifactsRepo.createToken('read', 3600)]);
			return { remote: info.remote, token: token.plaintext };
		});

		const checkout = await step.runner('checkout', {
			image,
			env: { GIT_TOKEN: repo.token, REMOTE: repo.remote, COMMIT: commit },
			command: [
				'git init -q repo && cd repo',
				'git -c http.extraHeader="Authorization: Bearer $GIT_TOKEN" fetch -q --depth 1 "$REMOTE" "$COMMIT"',
				'git checkout -q FETCH_HEAD',
			].join(' && '),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// A GitHub Actions job shares one filesystem. Here every step starts a fresh container, so each
		// restores the outputs of the steps before it. The first failure skips the rest.
		const inputs: Charm[] = [repoCharm];
		const checks: Record<string, Check> = {};
		for (const { name, command, outputs } of STEPS) {
			if (Object.values(checks).some((check) => check.exitCode !== 0)) {
				checks[name] = { exitCode: null, log: '', skipped: true };
				continue;
			}
			const result = await step.runner(name, {
				image,
				inputs: [...inputs],
				env,
				command: `cd repo && ${command}`,
				outputs,
				allowFailure: true,
			});
			checks[name] = { exitCode: result.exitCode, log: result.logs.data };
			for (const charm of Object.values(result.outputs)) if (charm) inputs.push(charm);
		}

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: Object.values(checks).every((check) => check.exitCode === 0),
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/ordered-deploy on pushes to its Artifacts repo.'),
};
