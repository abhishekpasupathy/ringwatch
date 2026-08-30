import assert from "node:assert/strict";
import {
  fitLogisticRegression,
  predictProbability,
  standardizeFeatures,
  type LabeledExample,
} from "../lib/ml-detector";

const examples: LabeledExample[] = [
  { features: [0, 0, 0], label: 0 },
  { features: [0.1, 0.2, 0], label: 0 },
  { features: [0.2, 0.1, 0], label: 0 },
  { features: [0.8, 0.9, 1], label: 1 },
  { features: [0.9, 0.8, 1], label: 1 },
  { features: [1, 1, 1], label: 1 },
];

const standardized = standardizeFeatures(examples.map((e) => e.features));
const model = fitLogisticRegression(standardized.values, examples.map((e) => e.label), {
  learningRate: 0.15,
  iterations: 2000,
  positiveClassWeight: 2,
});

const low = predictProbability(model, standardized.transform([0.05, 0.05, 0]));
const high = predictProbability(model, standardized.transform([0.95, 0.95, 1]));

assert.ok(low < high, `expected low-risk probability ${low} < high-risk probability ${high}`);
assert.ok(high > 0.8, `expected high-risk probability > 0.8, got ${high}`);
assert.equal(model.weights.length, 3);
assert.equal(model.means.length, 3);
assert.equal(model.scales.length, 3);

console.log("PASS: supervised logistic detector learns risk ordering and standardizes features");
