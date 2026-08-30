import { predictGradientProbabilities, trainGradientBoosting } from "../lib/gradient-boosting-detector";

const features = [
  [0, 0],
  [0.1, 0.1],
  [0.2, 0.2],
  [0.8, 0.8],
  [0.9, 0.9],
  [1, 1],
];
const labels = [0, 0, 0, 1, 1, 1];

const model = trainGradientBoosting(features, labels, {
  nEstimators: 20,
  learningRate: 0.08,
  maxDepth: 2,
  subsample: 1,
  randomState: 42,
});
const probabilities = predictGradientProbabilities(model, features);

if (!(probabilities[5] > probabilities[0])) {
  throw new Error("Gradient boosting did not learn the expected risk ordering");
}

console.log("PASS: gradient boosting learns a nonlinear risk ordering");
