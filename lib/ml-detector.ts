export interface LabeledExample {
  features: number[];
  label: 0 | 1;
}

export interface StandardizedFeatures {
  values: number[][];
  means: number[];
  scales: number[];
  transform: (features: number[]) => number[];
}

export interface LogisticModel {
  weights: number[];
  bias: number;
  means: number[];
  scales: number[];
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function standardizeFeatures(features: number[][]): StandardizedFeatures {
  if (features.length === 0) throw new Error("Cannot standardize an empty feature matrix");

  const width = features[0].length;
  if (width === 0 || features.some((row) => row.length !== width)) {
    throw new Error("Feature matrix must be rectangular and non-empty");
  }

  const means = Array.from({ length: width }, (_, j) =>
    features.reduce((sum, row) => sum + row[j], 0) / features.length
  );
  const scales = Array.from({ length: width }, (_, j) => {
    const variance =
      features.reduce((sum, row) => sum + (row[j] - means[j]) ** 2, 0) /
      features.length;
    return Math.sqrt(variance) || 1;
  });

  const transform = (row: number[]) => {
    if (row.length !== width) throw new Error("Feature vector has the wrong width");
    return row.map((value, j) => (value - means[j]) / scales[j]);
  };

  return { values: features.map(transform), means, scales, transform };
}

export function fitLogisticRegression(
  features: number[][],
  labels: (0 | 1)[],
  options: {
    learningRate?: number;
    iterations?: number;
    batchSize?: number;
    positiveClassWeight?: number;
    l2?: number;
  } = {}
): LogisticModel {
  if (features.length === 0 || features.length !== labels.length) {
    throw new Error("Features and labels must be non-empty and have equal length");
  }

  const standardized = standardizeFeatures(features);
  const x = standardized.values;
  const learningRate = options.learningRate ?? 0.05;
  const iterations = options.iterations ?? 400;
  const batchSize = Math.min(options.batchSize ?? 4096, x.length);
  const positiveClassWeight = options.positiveClassWeight ?? 1;
  const l2 = options.l2 ?? 0.001;
  const width = x[0].length;
  const weights = new Array<number>(width).fill(0);
  let bias = 0;

  // Mini-batch gradient descent keeps training practical on hundreds of thousands
  // of accounts while cycling deterministically through the training matrix.
  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradients = new Array<number>(width).fill(0);
    let biasGradient = 0;
    const start = (iteration * batchSize) % x.length;
    const count = Math.min(batchSize, x.length);

    for (let offset = 0; offset < count; offset++) {
      const i = (start + offset) % x.length;
      const row = x[i];
      const label = labels[i];
      const probability = sigmoid(
        bias + row.reduce((sum, value, j) => sum + value * weights[j], 0)
      );
      const classWeight = label === 1 ? positiveClassWeight : 1;
      const error = (probability - label) * classWeight;

      for (let j = 0; j < width; j++) gradients[j] += error * row[j];
      biasGradient += error;
    }

    const scale = 1 / count;
    for (let j = 0; j < width; j++) {
      weights[j] -= learningRate * (gradients[j] * scale + l2 * weights[j]);
    }
    bias -= learningRate * biasGradient * scale;
  }

  return {
    weights,
    bias,
    means: standardized.means,
    scales: standardized.scales,
  };
}

export function predictProbability(model: LogisticModel, features: number[]): number {
  if (features.length !== model.weights.length) {
    throw new Error("Feature vector has the wrong width");
  }
  const standardized = features.map(
    (value, j) => (value - model.means[j]) / model.scales[j]
  );
  const logit =
    model.bias + standardized.reduce((sum, value, j) => sum + value * model.weights[j], 0);
  return sigmoid(logit);
}

export function chooseThreshold(
  probabilities: number[],
  labels: (0 | 1)[],
  candidates: number[] = Array.from({ length: 19 }, (_, i) => 0.05 + i * 0.05)
): { threshold: number; precision: number; recall: number; f1: number } {
  if (probabilities.length === 0 || probabilities.length !== labels.length) {
    throw new Error("Probabilities and labels must be non-empty and have equal length");
  }

  let best = { threshold: 0.5, precision: 0, recall: 0, f1: 0 };
  for (const threshold of candidates) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (let i = 0; i < probabilities.length; i++) {
      const predicted = probabilities[i] >= threshold;
      if (predicted && labels[i] === 1) tp++;
      else if (predicted && labels[i] === 0) fp++;
      else if (!predicted && labels[i] === 1) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    if (f1 > best.f1) best = { threshold, precision, recall, f1 };
  }

  return best;
}
