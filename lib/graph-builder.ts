/**
 * RingWatch — Graph Builder (Stage 2)
 *
 * Builds a weighted undirected graphology Graph from transaction data.
 */

import Graph from "graphology";
import louvain from "graphology-communities-louvain";

export interface EdgeData {
  fromId: string;
  toId: string;
  timestamps: Date[];
  amountPaid: number;
  paymentFormats: Set<string>;
}

export interface GraphBuildResult {
  graph: Graph;
  communities: Record<string, number>;
  modularityScore: number;
  runCount: number;
}

const N_RUNS = 5;
const BURST_WINDOW_MS = 60 * 60 * 1000;
const BURST_THRESHOLD = 3;

export function buildGraph(
  transactions: {
    fromAccountId: string;
    toAccountId: string;
    amountPaid: number;
    timestamp: Date;
    paymentFormat: string;
  }[],
  amountP99: number
): GraphBuildResult {
  const edgeMap = new Map<string, EdgeData>();
  const nodeSet = new Set<string>();

  for (const tx of transactions) {
    const { fromAccountId: from, toAccountId: to } = tx;
    // A transfer to the same account cannot establish a ring relationship and
    // otherwise makes the undirected density exceed 1.0 for small clusters.
    if (from === to) continue;
    nodeSet.add(from);
    nodeSet.add(to);

    const [a, b] = [from, to].sort();
    const key = `${a}|||${b}`;

    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        fromId: a,
        toId: b,
        timestamps: [],
        amountPaid: 0,
        paymentFormats: new Set(),
      });
    }

    const e = edgeMap.get(key)!;
    e.timestamps.push(tx.timestamp);
    e.amountPaid += tx.amountPaid;
    e.paymentFormats.add(tx.paymentFormat);
  }

  const graph = new Graph({ type: "undirected", multi: false });

  for (const nodeId of Array.from(nodeSet).sort()) {
    graph.addNode(nodeId);
  }

  for (const key of Array.from(edgeMap.keys()).sort()) {
    const edge = edgeMap.get(key)!;
    const txCount = edge.timestamps.length;
    const avgAmount = edge.amountPaid / txCount;
    const normalizedAmount = Math.min(avgAmount / amountP99, 1.0);

    const sortedTs = edge.timestamps.slice().sort((a, b) => a.getTime() - b.getTime());
    let hasBurst = false;
    for (let i = 0; i < sortedTs.length - BURST_THRESHOLD; i++) {
      const windowDelta =
        sortedTs[i + BURST_THRESHOLD].getTime() - sortedTs[i].getTime();
      if (windowDelta <= BURST_WINDOW_MS) {
        hasBurst = true;
        break;
      }
    }

    const burstFactor = hasBurst ? 2.0 : 1.0;
    const weight = Math.log(txCount + 1) * normalizedAmount * burstFactor;

    graph.addEdge(edge.fromId, edge.toId, {
      weight,
      txCount,
      avgAmount,
      hasBurst,
      // Keep the actual set on the edge (not just a per-edge count) so
      // community scoring can calculate diversity across the whole community.
      paymentFormats: Array.from(edge.paymentFormats).sort(),
      paymentFormatCount: edge.paymentFormats.size,
    });
  }

  let bestCommunities: Record<string, number> = {};
  let bestModularity = -Infinity;

  for (let run = 0; run < N_RUNS; run++) {
    const result = louvain.detailed(graph, { getEdgeWeight: "weight" });
    if (result.modularity > bestModularity) {
      bestModularity = result.modularity;
      bestCommunities = result.communities;
    }
  }

  return {
    graph,
    communities: bestCommunities,
    modularityScore: bestModularity,
    runCount: N_RUNS,
  };
}

export function percentile99(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.99);
  return sorted[idx] || sorted[sorted.length - 1];
}
