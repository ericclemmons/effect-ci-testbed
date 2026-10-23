// Read an operator-created, single-Worker template token's policies, never its value.
// Usage: node scripts/create-grant.ts ACCOUNT_ID TEMPLATE_TOKEN_ID WORKER REPO_ID OWNER_ID WORKFLOW_REF
const [accountId, tokenId, worker, repositoryId, repositoryOwnerId, workflowRef] = process.argv.slice(2);
if (!accountId || !/^[a-f0-9]{32}$/.test(accountId) || !tokenId || !/^[a-f0-9]{32}$/.test(tokenId)
  || !worker || !repositoryId || !repositoryOwnerId || !workflowRef || !process.env.CLOUDFLARE_API_TOKEN) {
  throw new Error("Supply ACCOUNT_ID TEMPLATE_TOKEN_ID WORKER REPO_ID OWNER_ID WORKFLOW_REF and operator CLOUDFLARE_API_TOKEN");
}
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/${tokenId}`, {
  headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: "error",
});
if (!response.ok) throw new Error(`Template read failed (${response.status})`);
const data = await response.json();
if (!data.success || !data.result?.policies?.length) throw new Error("Template policies missing");
const policies = data.result.policies.map((policy: any) => {
  if (policy.effect !== "allow" || !policy.permission_groups?.length
    || policy.permission_groups.some((group: any) => group.name !== "Individual Workers Editor")) {
    throw new Error("Template must contain only Individual Workers Editor; verify Specified Workers selects exactly the intended Worker");
  }
  return { effect: "allow", permission_groups: policy.permission_groups.map((group: any) => ({ id: group.id })), resources: policy.resources };
});
console.log(JSON.stringify([{
  repositoryId, repositoryOwnerId, ref: "refs/heads/main", workflowRef, accountId, worker,
  scopes: { "workers:edit": policies },
}], null, 2));
