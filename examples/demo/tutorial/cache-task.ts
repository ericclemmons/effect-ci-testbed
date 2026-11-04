/** Add `run: cachedBuild` to the starter's existing Vite+ defineConfig object. */
export const cachedBuild = {
  tasks: {
    build: {
      command: "tsc -b && vp build",
      cache: true,
    },
  },
};
