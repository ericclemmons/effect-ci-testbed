/** PROTOTYPE: Does comparing deployable outputs answer a different question
 * from source selection? No public API or durable deployment journal yet.
 */
export type Target = "staging" | "production"
export interface OutputIdentity { readonly assets: string; readonly config: string }
export interface OutputState {
  readonly build?: { readonly number: number; readonly output: OutputIdentity }
  readonly deployed: Readonly<Partial<Record<Target, OutputIdentity>>>
  readonly last: string
}
export const initialState: OutputState = { deployed: {}, last: "No build or successful deployment" }

export function changed(state: OutputState, target: Target): boolean {
  const current = state.build?.output, previous = state.deployed[target]
  return !current || !previous || current.assets !== previous.assets || current.config !== previous.config
}

export type Action =
  | { readonly type: "built"; readonly output: OutputIdentity }
  | { readonly type: "configured"; readonly config: string }
  | { readonly type: "verified-deployment"; readonly target: Target; readonly output: OutputIdentity }
  | { readonly type: "failed-deployment"; readonly target: Target }

export function transition(state: OutputState, action: Action): OutputState {
  if (action.type === "built") return { ...state,
    build: { number: (state.build?.number ?? 0) + 1, output: action.output }, last: "Built actual Node output" }
  if (action.type === "configured") return { ...state,
    ...(state.build ? { build: { ...state.build, output: { ...state.build.output, config: action.config } } } : {}),
    last: "Deployment serving policy changed independently of asset bytes" }
  if (action.type === "failed-deployment") return { ...state, last: `${action.target} failed; success baseline unchanged` }
  // Only the shell's successful file-copy + byte readback takes this transition.
  return { ...state, deployed: { ...state.deployed, [action.target]: action.output },
    last: `${action.target} local copy read back; success baseline advanced` }
}
