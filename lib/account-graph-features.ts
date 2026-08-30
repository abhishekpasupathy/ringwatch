export interface GraphFeatureTransaction {
  fromAccountId: string;
  toAccountId: string;
  amountPaid: number;
  amountReceived: number;
  paymentFormat: string;
}

export interface AccountGraphFeatures {
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  communitySize: number;
  communityDensity: number;
  communityTriangleCount: number;
  inOutAmountRatio: number;
}

function empty(): AccountGraphFeatures {
  return {
    inDegree: 0,
    outDegree: 0,
    totalDegree: 0,
    communitySize: 1,
    communityDensity: 0,
    communityTriangleCount: 0,
    inOutAmountRatio: 0,
  };
}

/**
 * Build graph-derived account features without using laundering labels.
 * Edges are treated as undirected for structural features, matching the
 * RingWatch community graph. Amount-flow features retain direction.
 */
export function buildAccountGraphFeatures(
  transactions: GraphFeatureTransaction[],
  communities: Record<string, number>
): Map<string, AccountGraphFeatures> {
  const features = new Map<string, AccountGraphFeatures>();
  const neighbors = new Map<string, Set<string>>();
  const communityNodes = new Map<number, Set<string>>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const received = new Map<string, number>();
  const sent = new Map<string, number>();

  const ensure = (id: string) => {
    if (!features.has(id)) features.set(id, empty());
    if (!neighbors.has(id)) neighbors.set(id, new Set());
    if (!communityNodes.has(communities[id])) communityNodes.set(communities[id], new Set());
    communityNodes.get(communities[id])!.add(id);
  };

  for (const tx of transactions) {
    ensure(tx.fromAccountId);
    ensure(tx.toAccountId);
    neighbors.get(tx.fromAccountId)!.add(tx.toAccountId);
    neighbors.get(tx.toAccountId)!.add(tx.fromAccountId);
    outgoing.set(tx.fromAccountId, (outgoing.get(tx.fromAccountId) ?? 0) + 1);
    incoming.set(tx.toAccountId, (incoming.get(tx.toAccountId) ?? 0) + 1);
    sent.set(tx.fromAccountId, (sent.get(tx.fromAccountId) ?? 0) + tx.amountPaid);
    received.set(tx.toAccountId, (received.get(tx.toAccountId) ?? 0) + tx.amountReceived);
  }

  for (const [id, value] of features) {
    const communityId = communities[id];
    const nodes = communityNodes.get(communityId) ?? new Set<string>([id]);
    const n = nodes.size;
    const degree = neighbors.get(id)?.size ?? 0;

    // Count unique undirected edges inside this account's community once.
    let internalEdges = 0;
    for (const node of nodes) {
      for (const neighbor of neighbors.get(node) ?? []) {
        if (nodes.has(neighbor) && node < neighbor) internalEdges++;
      }
    }
    const possibleEdges = n > 1 ? (n * (n - 1)) / 2 : 0;
    const density = possibleEdges > 0 ? internalEdges / possibleEdges : 0;

    let triangles = 0;
    const ownNeighbors = neighbors.get(id) ?? new Set<string>();
    for (const a of ownNeighbors) {
      if (!nodes.has(a)) continue;
      for (const b of ownNeighbors) {
        if (a >= b || !nodes.has(b)) continue;
        if (neighbors.get(a)?.has(b)) triangles++;
      }
    }

    const inAmount = received.get(id) ?? 0;
    const outAmount = sent.get(id) ?? 0;
    const ratio = outAmount > 0 ? inAmount / outAmount : inAmount > 0 ? 2 : 0;

    value.inDegree = incoming.get(id) ?? 0;
    value.outDegree = outgoing.get(id) ?? 0;
    value.totalDegree = degree;
    value.communitySize = n;
    value.communityDensity = density;
    value.communityTriangleCount = triangles;
    value.inOutAmountRatio = Math.min(ratio, 2);
  }

  return features;
}
