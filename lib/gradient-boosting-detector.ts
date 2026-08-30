import { Ensemble } from "@kanaries/ml";

export interface GradientBoostingModel {
  model: unknown;
  featureCount: number;
}

export function trainGradientBoosting(
  features: number[][],
  labels: number[],
  options: {
    nEstimators?: number;
    learningRate?: number;
    maxDepth?: number;
    subsample?: number;
    maxFeatures?: number | "sqrt" | "log2";
    randomState?: number;
  } = {}
): GradientBoostingModel {
  const model = new Ensemble.GradientBoostingClassifier({
    nEstimators: options.nEstimators ?? 60,
    learningRate: options.learningRate ?? 0.05,
    maxDepth: options.maxDepth ?? 3,
    subsample: options.subsample ?? 0.8,
    maxFeatures: options.maxFeatures ?? "sqrt",
    randomState: options.randomState ?? 42,
  });
  model.fit(features, labels);
  return { model, featureCount: features[0]?.length ?? 0 };
}

export function predictGradientProbabilities(
  fitted: GradientBoostingModel,
  features: number[][]
): number[] {
  const model = fitted.model as {
    predictProba: (rows: number[][]) => number[][];
  };
  return model.predictProba(features).map((row) => row[1] ?? 0);
}
