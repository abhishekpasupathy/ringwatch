/**
 * RingWatch — Graph Builder (Stage 2)
 *
 * Builds a weighted undirected graphology Graph from transaction data.
 *
 * DETERMINISM STRATEGY:
 * graphology-communities-louvain has no seed parameter (confirmed limitation).
 * We mitigate non-determinism by:
 *   1. Sorting nodes by ID string before addNode() — makes traversal order
 *      consistent for the same input data
 *   2. Sorting edges by "fromId|toId" before addEdge()
 *   3. Running Louvain N_RUNS times and selecting the partition with the
 *      highest modularity score
 *
 * KNOWN HONEST FAILURE POINT: Even with sorted input, graphology's internal
 * Set/Map iteration order can differ across JS engine versions (V8 minor
 * versions ship non-deterministic hash seeds). Results are stable-but-not-
 * bit-identical across environments. Production fix: use a consensus ensemble
 * or switch to Label Propagation (fully deterministic). This variance is
 * explicitly documented in eval-report.md.
 *
 * EDGE WEIGHT FORMULA:
 *   weight = log(txCount + 1)
 *            × normalizedAvgAmount   (0..1 scale, clipped at 99th pct)
 *            × timeBurstFactor       (2.0 if >3 txns in 1hr window, else 1.0)
 *
 * This composite captures three fraud-ring signals:
 *   - Repeated small transfers (obfuscation pattern)
 *   - Large single transfers (value extraction)
 *   - Rapid synchronized bursts (coordinated ring behavior)
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
  communities: Record<string, number>; // nodeId → communityId
  modularityScore: number;
  runCount: number;
}

const N_RUNS = 5;
const BURST_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const BURST_THRESHOLD = 3; // >3 txns between same pair within window

/**
 * Builds the weighted undirected graphology Graph.
 * @param transactions Array of transaction rows from the DB.
 * @param amountP99 99th percentile of amountPaid across the dataset
 *                  (used to normalize amounts to 0..1 range).
 */
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
  // ── Step 1: Aggregate edge data ──────────────────────────────────────────
  const edgeMap = new Map<string, EdgeData>();
  const nodeSet = new Set<string>();

  for (const tx of transactions) {
    const { fromAccountId: from, toAccountId: to } = tx;
    nodeSet.add(from);
    nodeSet.add(to);

    // Canonical undirected edge key: always sort endpoints alphabetically
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

  // ── Step 2: Build graph with sorted node/edge insertion (determinism) ───
  const graph = new Graph({ type: "undirected", multi: false });

  // Sort nodes alphabetically before insertion
  const sortedNodes = Array.from(nodeSet).sort();
  for (const nodeId of sortedNodes) {
    graph.addNode(nodeId);
  }

  // Sort edges before insertion
  const sortedEdgeKeys = Array.from(edgeMap.keys()).sort();

  for (const key of sortedEdgeKeys) {
    const edge = edgeMap.get(key)!;
    const txCount = edge.timestamps.length;
    const avgAmount = edge.amountPaid / txCount;

    // Normalize amount (clip at P99)
    const normalizedAmount = Math.min(avgAmount / amountP99, 1.0);

    // Time burst factor: check if >BURST_THRESHOLD txns within BURST_WINDOW_MS
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

    const weight =
      Math.log(txCount + 1) * normalizedAmount * burstFactor;

    graph.addEdge(edge.fromId, edge.toId, {
      weight,
      txCount,
      avgAmount,
      hasBurst,
      paymentFormatCount: edge.paymentFormats.size,
    });
  }

  // ── Step 3: Run Louvain N_RUNS times, keep highest modularity ───────────
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

/**
 * Computes the 99th percentile of an array of numbers.
 * Used to normalize edge amounts without outlier distortion.
 */
export function percentile99(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.99);
  return sorted[idx] || sorted[sorted.length - 1];
}
