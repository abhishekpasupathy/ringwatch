import assert from "node:assert/strict";
import Graph from "graphology";
import { scoreAllCommunities } from "../lib/detector";

const graph = new Graph({ type: "undirected", multi: false });
for (const node of ["A", "B", "C"]) graph.addNode(node);
graph.addEdge("A", "B", { hasBurst: false, paymentFormats: ["ACH", "WIRE"] });
graph.addEdge("B", "C", { hasBurst: false, paymentFormats: ["CASH"] });
graph.addEdge("A", "C", { hasBurst: true, paymentFormats: ["ACH"] });

const communities = { A: 0, B: 0, C: 0 };

const noLabels = scoreAllCommunities(graph, communities, new Set(), 0.0)[0];
const allLabels = scoreAllCommunities(graph, communities, new Set(["A", "B", "C"]), 0.0)[0];

// Ground-truth labels must not change the prediction score.
assert.equal(noLabels.suspicionScore, allLabels.suspicionScore);
assert.equal(noLabels.paymentFormatDiversity, 1);

console.log("PASS: detector score is label-independent and payment diversity is populated");
