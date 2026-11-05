import * as Graph from "effect/Graph"
import { WorkflowPlanError, type PlanNode, type WorkflowPlan } from "@effect-ci-testbed/ci"

type PlanEdge = "dependency" | "after" | "rollback"

/**
 * A derived view of the serializable plan, with prerequisites pointing to consumers.
 * Edge kinds preserve value, ordering and recovery relationships. A visualization
 * graph includes rollback edges; it is not an execution schedule or necessarily a DAG.
 * Action IDs remain in node payloads; Graph indices are local to this view.
 */
const toPlanGraph = (plan: WorkflowPlan): Graph.DirectedGraph<PlanNode, PlanEdge> =>
  Graph.directed<PlanNode, PlanEdge>((graph) => {
    const indices = new Map<string, Graph.NodeIndex>()
    for (const node of plan.nodes) {
      if (indices.has(node.id)) throw new WorkflowPlanError(`Duplicate workflow node: ${node.id}`)
      indices.set(node.id, Graph.addNode(graph, node))
    }

    const connect = (source: string, target: string, kind: PlanEdge): void => {
      const sourceIndex = indices.get(source)
      const targetIndex = indices.get(target)
      if (sourceIndex === undefined || targetIndex === undefined) {
        throw new WorkflowPlanError(`Unknown workflow node: ${sourceIndex === undefined ? source : target}`)
      }
      Graph.addEdge(graph, sourceIndex, targetIndex, kind)
    }
    for (const node of plan.nodes) {
      for (const dependency of node.dependencies) connect(dependency, node.id, "dependency")
      for (const predecessor of node.after) connect(predecessor, node.id, "after")
      if (node.rollbackFor) connect(node.rollbackFor, node.id, "rollback")
    }
  })

const planNodeLabel = (node: PlanNode): string => {
  const qualifiers = [
    node.optional ? "optional" : undefined,
    node.condition ? "conditional" : undefined,
  ].filter((value): value is string => value !== undefined)
  return qualifiers.length > 0 ? `${node.id} (${qualifiers.join(", ")})` : node.id
}

/** Export the same plan graph to Graphviz-compatible tools. */
export const formatPlanDot = (plan: WorkflowPlan): string =>
  Graph.toGraphViz(toPlanGraph(plan), {
    graphName: plan.workflowId,
    nodeLabel: planNodeLabel,
    edgeLabel: (kind) => kind,
  })

/** Render the inspectable dependency graph without coupling it to a CI provider UI. */
export const formatPlanMermaid = (plan: WorkflowPlan): string => {
  const graph = toPlanGraph(plan)
  const ids = new Map<Graph.NodeIndex, string>()
  const used = new Set<string>()
  const lines = ["flowchart LR"]

  for (const [index, node] of Graph.entries(Graph.nodes(graph))) {
    let id = `step_${node.id.replaceAll(/[^a-zA-Z0-9_]/g, "_")}`
    while (used.has(id)) id += `_${index}`
    used.add(id)
    ids.set(index, id)
    lines.push(`  ${id}[${JSON.stringify(planNodeLabel(node))}]`)
  }

  // Effect's Mermaid exporter has no per-edge style option. Keep the plan's
  // ordering and rollback arrows distinct while reading all structure from Graph.
  for (const edge of Graph.values(Graph.edges(graph))) {
    const arrow = edge.data === "dependency" ? "-->" : edge.data === "after" ? "-.->" : "-. rollback .->"
    lines.push(`  ${ids.get(edge.source)!} ${arrow} ${ids.get(edge.target)!}`)
  }

  return lines.join("\n")
}

