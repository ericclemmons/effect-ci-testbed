/** Cloudflare durable_object processes may start with root capabilities even
 * at uid 1000. Restrict every showcase command before any project shell starts.
 * setpriv fails closed if the kernel cannot apply a requested restriction.
 */
export const showcaseProcessPrefix = [
  "/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--clear-groups",
  "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--",
] as const;
export const showcaseReadyCommand = "/usr/local/bin/node /opt/effect-ci-showcase/verify-process.cjs";
