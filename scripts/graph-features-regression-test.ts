import { buildAccountGraphFeatures } from "../lib/account-graph-features";

const transactions = [
  { fromAccountId: "A", toAccountId: "B", amountPaid: 100, amountReceived: 100, paymentFormat: "ACH" },
  { fromAccountId: "B", toAccountId: "C", amountPaid: 200, amountReceived: 200, paymentFormat: "WIRE" },
  { fromAccountId: "C", toAccountId: "A", amountPaid: 300, amountReceived: 300, paymentFormat: "ACH" },
  { fromAccountId: "A", toAccountId: "D", amountPaid: 50, amountReceived: 50, paymentFormat: "CASH" },
];

const communities = { A: 1, B: 1, C: 1, D: 2 };
const features = buildAccountGraphFeatures(transactions, communities);
const a = features.get("A");

if (!a) throw new Error("Missing account A features");
if (a.inDegree !== 1 || a.outDegree !== 2) throw new Error("Incorrect degree features");
if (a.communitySize !== 3) throw new Error("Incorrect community size");
if (!(a.communityDensity > 0 && a.communityDensity <= 1)) throw new Error("Incorrect community density");
if (a.communityTriangleCount !== 1) throw new Error("Triangle count was not detected");

console.log("PASS: graph features capture degree, community density, and triangles");
