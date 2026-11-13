import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep, StepResult } from './workflows-internal';

type Check = { exitCode: number | null; log: string; optional?: boolean; skipped?: boolean };

const image = 'workflows/node';
// Every step starts a fresh container, so each one enables the pnpm version pinned in packageManager.
const pnpm = (command: string) => `cd repo && corepack enable && ${command}`;
const env = { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'node-pnpm / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('node-pnpm'),
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
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: Object.values(checks).every((check) => check.optional || check.exitCode === 0),
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/node-pnpm on GitHub commits.'),
};
