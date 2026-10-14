import type { PluginConfig } from "@cloudflare/vite-plugin";

type Customizer = Extract<NonNullable<PluginConfig["config"]>, (config: never) => unknown>;
type Config = Parameters<Customizer>[0];
const rejected = () =>
  new Error("Generated Flue config is incompatible or conflicts with host config");
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Explicit GENERATED-entrypoint bridge for pinned Flue 2.2.2 -> cf config.
 * Calls the REAL public flueWorkerConfig() customizer after flue() scans agents.
 * Never creates a replacement runtime, copies generated classes or deletes any
 * authored export/binding. Do not use this to replace a broker's RPC entrypoint.
 */
export function generatedFlueWorkerConfig(configure: (legacy: object) => void): Customizer {
  return (config: Config) => {
    const legacy: Record<string, unknown> = {
      compatibility_date: config.compatibilityDate,
      compatibility_flags: [...(config.compatibilityFlags ?? [])],
    };
    configure(legacy);
    // Flue's public customizer is intentionally a no-op during preview.
    if (legacy.main === undefined && legacy.durable_objects === undefined) return {};
    if (
      legacy.main !== "virtual:flue/worker" ||
      !Array.isArray(legacy.compatibility_flags) ||
      !legacy.compatibility_flags.every((flag) => typeof flag === "string") ||
      !legacy.compatibility_flags.includes("nodejs_compat") ||
      !object(legacy.durable_objects) ||
      !Array.isArray(legacy.durable_objects.bindings) ||
      legacy.durable_objects.bindings.length > 32 ||
      Object.keys(legacy).some(
        (key) =>
          !["main", "compatibility_date", "compatibility_flags", "durable_objects"].includes(key),
      )
    )
      throw rejected();
    const env = { ...config.env };
    const exports = { ...config.exports };
    const names = new Set<string>();
    const classes = new Set<string>();
    for (const binding of legacy.durable_objects.bindings) {
      if (
        !object(binding) ||
        Object.keys(binding).some((key) => !["name", "class_name"].includes(key)) ||
        typeof binding.name !== "string" ||
        !/^FLUE_[A-Z0-9_]{1,80}$/.test(binding.name) ||
        typeof binding.class_name !== "string" ||
        !/^Flue[A-Za-z0-9_]{1,80}Agent$/.test(binding.class_name) ||
        names.has(binding.name) ||
        classes.has(binding.class_name) ||
        Object.hasOwn(env, binding.name) ||
        Object.hasOwn(exports, binding.class_name)
      )
        throw rejected();
      names.add(binding.name);
      classes.add(binding.class_name);
      exports[binding.class_name] = { type: "durable-object", storage: "sqlite" };
      env[binding.name] = {
        type: "durable-object",
        worker: config.name,
        exportName: binding.class_name,
      };
    }
    return {
      entrypoint: legacy.main,
      compatibilityFlags: legacy.compatibility_flags,
      exports,
      env,
    };
  };
}
