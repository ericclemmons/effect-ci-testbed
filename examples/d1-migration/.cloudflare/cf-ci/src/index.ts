import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep, Charm, StepResult } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};
type Check = { exitCode: number | null; log: string; skipped?: true };

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
const database = '11111111-1111-4111-8111-111111111111';
// Local D1 state lives in the checkout, so the migration saves it for the rollback.
const local = '--local --persist-to .effect-ci-state --quiet';

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

		const run = (name: string, inputs: Charm[], command: string, outputs?: Record<string, string>) =>
			step.runner(name, { image, inputs, env, command: `cd repo && ${command}`, outputs, allowFailure: true });
		const toCheck = (result: StepResult | null): Check =>
			result ? { exitCode: result.exitCode, log: result.logs.data } : { exitCode: null, log: '', skipped: true };
		const saved = (result: StepResult) => Object.values(result.outputs).filter((charm) => charm !== null);

		const install = await run('npm install', [repoCharm], 'npm install', { modules: 'repo/node_modules' });
		const build =
			install.exitCode === 0
				? await run('build', [repoCharm, ...saved(install)], 'npx cf build --mode production', { build: 'repo/.cloudflare/output' })
				: null;
		const built = build ? [repoCharm, ...saved(install), ...saved(build)] : [];

		// continue-on-error on migrate and deploy: either failure rolls the migration back.
		const migrate =
			build?.exitCode === 0
				? await run('migrate', built, `npx cf d1 migrations apply ${database} --dir migrations ${local}`, { state: 'repo/.effect-ci-state' })
				: null;
		const deploy =
			migrate?.exitCode === 0 ? await run('deploy', [...built, ...saved(migrate)], 'npx cf deploy --prebuilt --mode production --dry-run') : null;
		const migrationFailed = migrate !== null && (migrate.exitCode !== 0 || deploy?.exitCode !== 0);
		const rollback = migrationFailed
			? await run(
					'roll back migration',
					[...built, ...saved(migrate)],
					`npx cf d1 raw ${database} --sql "DROP TABLE IF EXISTS users; DELETE FROM d1_migrations WHERE name = '0001_create_users.sql'" ${local}`,
				)
			: null;

		// The rollback does not erase the original failure.
		const checks = {
			install: toCheck(install),
			build: toCheck(build),
			migrate: toCheck(migrate),
			deploy: toCheck(deploy),
			rollback: toCheck(rollback),
		};
		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: install.exitCode === 0 && build?.exitCode === 0 && migrate?.exitCode === 0 && deploy?.exitCode === 0,
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/d1-migration on pushes to its Artifacts repo.'),
};
