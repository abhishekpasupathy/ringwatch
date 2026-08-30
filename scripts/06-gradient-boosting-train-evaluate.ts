import prisma from "../lib/db";
import { buildGraph, percentile99 } from "../lib/graph-builder";
import { buildAccountGraphFeatures } from "../lib/account-graph-features";
import { chooseThreshold } from "../lib/ml-detector";
import { predictGradientProbabilities, trainGradientBoosting } from "../lib/gradient-boosting-detector";

interface AccountFeatures {
  txCount: number;
  incomingCount: number;
  outgoingCount: number;
  totalReceived: number;
  totalSent: number;
  uniqueCounterparties: Set<string>;
  paymentFormats: Set<string>;
}

function emptyFeatures(): AccountFeatures {
  return { txCount: 0, incomingCount: 0, outgoingCount: 0, totalReceived: 0, totalSent: 0, uniqueCounterparties: new Set(), paymentFormats: new Set() };
}

function buildBehaviorFeatures(transactions: {
  fromAccountId: string; toAccountId: string; amountPaid: number; amountReceived: number; paymentFormat: string;
}[]): Map<string, AccountFeatures> {
  const result = new Map<string, AccountFeatures>();
  for (const tx of transactions) {
    const from = result.get(tx.fromAccountId) ?? emptyFeatures();
    const to = result.get(tx.toAccountId) ?? emptyFeatures();
    from.txCount++; from.outgoingCount++; from.totalSent += tx.amountPaid;
    from.uniqueCounterparties.add(tx.toAccountId); from.paymentFormats.add(tx.paymentFormat);
    to.txCount++; to.incomingCount++; to.totalReceived += tx.amountReceived;
    to.uniqueCounterparties.add(tx.fromAccountId); to.paymentFormats.add(tx.paymentFormat);
    result.set(tx.fromAccountId, from); result.set(tx.toAccountId, to);
  }
  return result;
}

function vector(behavior: AccountFeatures, graph: ReturnType<typeof buildAccountGraphFeatures> extends Map<string, infer T> ? T : never): number[] {
  return [
    Math.log1p(behavior.txCount),
    Math.log1p(behavior.incomingCount),
    Math.log1p(behavior.outgoingCount),
    Math.log1p(behavior.totalReceived),
    Math.log1p(behavior.totalSent),
    Math.log1p(behavior.uniqueCounterparties.size),
    Math.log1p(behavior.paymentFormats.size),
    Math.log1p(graph.inDegree),
    Math.log1p(graph.outDegree),
    Math.log1p(graph.totalDegree),
    Math.log1p(graph.communitySize),
    graph.communityDensity,
    Math.log1p(graph.communityTriangleCount),
    graph.inOutAmountRatio,
  ];
}

function metrics(probabilities: number[], labels: number[], threshold: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < labels.length; i++) {
    const predicted = probabilities[i] >= threshold;
    if (predicted && labels[i] === 1) tp++;
    else if (predicted && labels[i] === 0) fp++;
    else if (!predicted && labels[i] === 1) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1 };
}

function sampleNegatives(examples: { features: number[]; label: number }[], maxNegativesPerPositive: number) {
  const positives = examples.filter((e) => e.label === 1);
  const negatives = examples.filter((e) => e.label === 0);
  const limit = Math.max(positives.length * maxNegativesPerPositive, 1);
  const stride = Math.max(1, Math.ceil(negatives.length / limit));
  const sampled = negatives.filter((_, i) => i % stride === 0).slice(0, limit);
  return [...positives, ...sampled];
}

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 6: Graph + Gradient Boosting");
  console.log("══════════════════════════════════════════\n");

  const select = {
    fromAccountId: true,
    toAccountId: true,
    amountPaid: true,
    amountReceived: true,
    timestamp: true,
    paymentFormat: true,
    isLaunderingLabel: true,
  } as const;

  console.log("Loading TRAIN transactions...");
  const train = await prisma.transaction.findMany({ where: { split: "TRAIN" }, select });
  console.log("Loading TEST transactions...");
  const test = await prisma.transaction.findMany({ where: { split: "TEST" }, select });
  console.log(`  TRAIN transactions: ${train.length.toLocaleString()}`);
  console.log(`  TEST transactions:  ${test.length.toLocaleString()}`);

  const trainLabels = new Set<string>();
  const testLabels = new Set<string>();
  for (const tx of train) if (tx.isLaunderingLabel) { trainLabels.add(tx.fromAccountId); trainLabels.add(tx.toAccountId); }
  for (const tx of test) if (tx.isLaunderingLabel) { testLabels.add(tx.fromAccountId); testLabels.add(tx.toAccountId); }

  console.log("\nBuilding TRAIN graph features...");
  const trainGraphData = buildGraph(train, percentile99(train.map((t) => t.amountPaid)));
  const trainGraphFeatures = buildAccountGraphFeatures(train, trainGraphData.communities);
  console.log(`  TRAIN communities: ${new Set(Object.values(trainGraphData.communities)).size.toLocaleString()}`);

  console.log("Building TEST graph features...");
  const testGraphData = buildGraph(test, percentile99(test.map((t) => t.amountPaid)));
  const testGraphFeatures = buildAccountGraphFeatures(test, testGraphData.communities);
  console.log(`  TEST communities: ${new Set(Object.values(testGraphData.communities)).size.toLocaleString()}`);

  const trainBehavior = buildBehaviorFeatures(train);
  const testBehavior = buildBehaviorFeatures(test);
  const allTrain = Array.from(trainBehavior.entries()).map(([accountId, f]) => ({
    features: vector(f, trainGraphFeatures.get(accountId) ?? { inDegree: 0, outDegree: 0, totalDegree: 0, communitySize: 1, communityDensity: 0, communityTriangleCount: 0, inOutAmountRatio: 0 }),
    label: trainLabels.has(accountId) ? 1 : 0,
  }));
  const sampledTrain = sampleNegatives(allTrain, 20);

  console.log(`  TRAIN accounts: ${allTrain.length.toLocaleString()}`);
  console.log(`  Training sample: ${sampledTrain.length.toLocaleString()} (${sampledTrain.filter((e) => e.label === 1).length} positive, ${sampledTrain.filter((e) => e.label === 0).length} negative)`);

  console.log("\nTraining gradient-boosted trees with graph + behavior features...");
  const model = trainGradientBoosting(
    sampledTrain.map((e) => e.features),
    sampledTrain.map((e) => e.label),
    { nEstimators: 80, learningRate: 0.04, maxDepth: 3, subsample: 0.8, maxFeatures: "sqrt", randomState: 42 }
  );

  const trainProbabilities = predictGradientProbabilities(model, sampledTrain.map((e) => e.features));
  const selected = chooseThreshold(trainProbabilities, sampledTrain.map((e) => e.label as 0 | 1));
  console.log(`  Selected threshold from TRAIN: ${selected.threshold.toFixed(2)}`);
  console.log(`  TRAIN sample F1: ${(selected.f1 * 100).toFixed(2)}%`);

  const fallback = { inDegree: 0, outDegree: 0, totalDegree: 0, communitySize: 1, communityDensity: 0, communityTriangleCount: 0, inOutAmountRatio: 0 };
  const testExamples = Array.from(testBehavior.entries()).map(([accountId, f]) => ({
    features: vector(f, testGraphFeatures.get(accountId) ?? fallback),
    label: testLabels.has(accountId) ? 1 : 0,
  }));
  const testProbabilities = predictGradientProbabilities(model, testExamples.map((e) => e.features));
  const result = metrics(testProbabilities, testExamples.map((e) => e.label), selected.threshold);

  console.log("\n════════ TEST SET (HELD OUT) ════════");
  console.log(`  TP: ${result.tp}`);
  console.log(`  FP: ${result.fp}`);
  console.log(`  FN: ${result.fn}`);
  console.log(`  TN: ${result.tn}`);
  console.log(`  Precision: ${(result.precision * 100).toFixed(2)}%`);
  console.log(`  Recall:    ${(result.recall * 100).toFixed(2)}%`);
  console.log(`  F1:        ${(result.f1 * 100).toFixed(2)}%`);
  console.log("\nGraph + gradient boosting experiment complete.");
  console.log("  TEST labels were not used to train or select the threshold.");
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); prisma.$disconnect(); process.exit(1); });
