import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep, StepResult } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

type Check = { exitCode: number | null; log: string; optional?: boolean; skipped?: boolean };

const image = 'workflows/node';
// Every step starts a fresh container, so each one enables the pnpm version pinned in packageManager.
const pnpm = (command: string) => `cd repo && corepack enable && ${command}`;
const env = { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };

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

		// node-pnpm has no dependencies, so the install creates nothing to hand to later steps.
		await step.runner('install', { image, inputs: [repoCharm], env, command: pnpm('pnpm install --frozen-lockfile') });

		const run = (name: string) =>
			step.runner(name, { image, inputs: [repoCharm], env, command: pnpm(`pnpm run ${name}`), allowFailure: true });
		const toCheck = (result: StepResult, optional = false): Check => ({
			exitCode: result.exitCode,
			log: result.logs.data,
			...(optional ? { optional } : {}),
		});

		// Lint is required; format is advisory, like continue-on-error in the GitHub Actions comparison.
		const [lint, format] = await Promise.all([run('lint'), run('format')]);
		const checks: Record<string, Check> = { lint: toCheck(lint), format: toCheck(format, true) };

		if (lint.exitCode === 0) {
			const test = await run('test');
			checks.test = toCheck(test);
			checks.build = test.exitCode === 0 ? toCheck(await run('build')) : { exitCode: null, log: '', skipped: true };
		} else {
			checks.test = { exitCode: null, log: '', skipped: true };
			checks.build = { exitCode: null, log: '', skipped: true };
		}

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: Object.values(checks).every((check) => check.optional || check.exitCode === 0),
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/node-pnpm on pushes to its Artifacts repo.'),
};
