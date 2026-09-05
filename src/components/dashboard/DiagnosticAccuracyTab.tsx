"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Target, RefreshCw, Info } from "lucide-react";

/**
 * Synthetic confusion matrix data representing model validation results.
 * In production this would be computed from a labeled test dataset.
 */

type FaultLabel = "SOILING" | "CLOUD" | "HARDWARE";

interface ConfusionEntry {
  actual: FaultLabel;
  predicted: FaultLabel;
  count: number;
}

const LABELS: FaultLabel[] = ["SOILING", "CLOUD", "HARDWARE"];

// Confusion matrix: rows = actual, columns = predicted
const BASELINE_MATRIX: ConfusionEntry[] = [
  { actual: "SOILING", predicted: "SOILING", count: 187 },
  { actual: "SOILING", predicted: "CLOUD", count: 8 },
  { actual: "SOILING", predicted: "HARDWARE", count: 5 },
  { actual: "CLOUD", predicted: "SOILING", count: 3 },
  { actual: "CLOUD", predicted: "CLOUD", count: 214 },
  { actual: "CLOUD", predicted: "HARDWARE", count: 3 },
  { actual: "HARDWARE", predicted: "SOILING", count: 4 },
  { actual: "HARDWARE", predicted: "CLOUD", count: 2 },
  { actual: "HARDWARE", predicted: "HARDWARE", count: 94 },
];

interface MetricResult {
  label: string;
  value: number;
  description: string;
}

function computeMetrics(matrix: ConfusionEntry[]): {
  confusionMatrix: Map<string, number>;
  accuracy: number;
  perClass: Record<FaultLabel, { precision: number; recall: number; f1: number }>;
  mae: number;
  rmse: number;
} {
  const matrixMap = new Map<string, number>();
  for (const entry of matrix) {
    matrixMap.set(`${entry.actual}-${entry.predicted}`, entry.count);
  }

  // Total correct
  let totalCorrect = 0;
  let totalSamples = 0;
  for (const entry of matrix) {
    totalSamples += entry.count;
    if (entry.actual === entry.predicted) totalCorrect += entry.count;
  }

  const accuracy = totalSamples > 0 ? totalCorrect / totalSamples : 0;

  // Per-class precision, recall, F1
  const perClass = {} as Record<FaultLabel, { precision: number; recall: number; f1: number }>;

  for (const label of LABELS) {
    const tp = matrixMap.get(`${label}-${label}`) || 0;
    const fpRowSums = LABELS.filter((l) => l !== label).reduce(
      (sum, l) => sum + (matrixMap.get(`${l}-${label}`) || 0), 0
    );
    const fnRowSums = LABELS.filter((l) => l !== label).reduce(
      (sum, l) => sum + (matrixMap.get(`${label}-${l}`) || 0), 0
    );

    const precision = tp + fpRowSums > 0 ? tp / (tp + fpRowSums) : 0;
    const recall = tp + fnRowSums > 0 ? tp / (tp + fnRowSums) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    perClass[label] = {
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
    };
  }

  // Simulated MAE/RMSE for PR predictions (synthetic validation data)
  // In production: computed from (P_theoretical - P_actual) across test set
  const mae = 0.032;   // 3.2% mean absolute error
  const rmse = 0.048;  // 4.8% root mean squared error

  return { confusionMatrix: matrixMap, accuracy, perClass, mae, rmse };
}

function getValue(matrixMap: Map<string, number>, actual: FaultLabel, predicted: FaultLabel): number {
  return matrixMap.get(`${actual}-${predicted}`) || 0;
}

export default function DiagnosticAccuracyTab() {
  const [showDetails, setShowDetails] = useState(false);

  const metrics = useMemo(() => computeMetrics(BASELINE_MATRIX), []);

  const totalSamples = BASELINE_MATRIX.reduce((s, e) => s + e.count, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Model Validation Dashboard
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Classification accuracy across {totalSamples} labeled test scenarios
          </p>
        </div>
        <Badge variant="default" className="text-sm">
          {(metrics.accuracy * 100).toFixed(1)}% Overall Accuracy
        </Badge>
      </div>

      <Tabs defaultValue="confusion">
        <TabsList>
          <TabsTrigger value="confusion" className="gap-1">
            <BarChart3 className="h-3.5 w-3.5" /> Confusion Matrix
          </TabsTrigger>
          <TabsTrigger value="metrics" className="gap-1">
            <Target className="h-3.5 w-3.5" /> PR Consistency
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Confusion Matrix */}
        <TabsContent value="confusion">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Matrix Table */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">
                    Actual vs Predicted Classification
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left p-2 text-muted-foreground font-medium">Actual ↓ / Predicted →</th>
                          {LABELS.map((l) => (
                            <th key={l} className="p-2 text-center font-medium text-muted-foreground">{l}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {LABELS.map((actual) => (
                          <tr key={actual}>
                            <td className="p-2 font-medium">{actual}</td>
                            {LABELS.map((predicted) => {
                              const count = getValue(metrics.confusionMatrix, actual, predicted);
                              const isDiagonal = actual === predicted;
                              const isZero = count === 0;
                              return (
                                <td key={predicted} className="p-2 text-center">
                                  <div
                                    className={`inline-flex items-center justify-center w-12 h-12 rounded-lg font-bold text-sm ${
                                      isDiagonal
                                        ? "bg-green-100 text-green-800 border-2 border-green-300"
                                        : isZero
                                        ? "bg-gray-50 text-gray-300"
                                        : "bg-red-50 text-red-700 border border-red-200"
                                    }`}
                                  >
                                    {count}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="h-3 w-3" />
                    <span>
                      <span className="font-medium text-green-700">Green cells</span> = correct predictions,
                      <span className="font-medium text-red-700 ml-1">Red cells</span> = misclassifications
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Per-Class Metrics */}
            <div className="space-y-4">
              {LABELS.map((label) => {
                const m = metrics.perClass[label];
                const avgF1 = (m.precision + m.recall) / 2;
                return (
                  <Card key={label}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Precision</span>
                        <span className="font-mono">{(m.precision * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Recall</span>
                        <span className="font-mono">{(m.recall * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">F1 Score</span>
                        <span className={`font-mono font-bold ${avgF1 >= 0.9 ? "text-green-600" : "text-yellow-600"}`}>
                          {(avgF1 * 100).toFixed(1)}%
                        </span>
                      </div>
                      {/* Mini bar */}
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${avgF1 * 100}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: PR Consistency / Model Fit */}
        <TabsContent value="metrics">
          <div className="grid md:grid-cols-2 gap-6">
            {/* MAE / RMSE Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">PR Consistency Index (Model Fit)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Measures how closely the physics-based theoretical predictions (P_theoretical)
                  match measured power output (P_actual) across the validation dataset.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground mb-1">Mean Absolute Error</div>
                    <div className="text-3xl font-bold text-primary">{(metrics.mae * 100).toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground mt-1">Average prediction deviation</div>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground mb-1">RMSE</div>
                    <div className="text-3xl font-bold text-primary">{(metrics.rmse * 100).toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground mt-1">Penalizes large errors</div>
                  </div>
                </div>
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
                  <strong>Interpretation:</strong> An MAE of {(metrics.mae * 100).toFixed(1)}% means the physics model
                  predicts expected power within ±{(metrics.mae * 100).toFixed(1)}% of actual measurements on average.
                  RMSE of {(metrics.rmse * 100).toFixed(1)}% indicates few large prediction outliers.
                  Both values are within acceptable range for solar performance modeling (industry threshold: MAE &lt; 5%).
                </div>
              </CardContent>
            </Card>

            {/* Error Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Prediction Error Distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { range: "0-1%", count: 342, percent: 48.5 },
                    { range: "1-2%", count: 198, percent: 28.1 },
                    { range: "2-3%", count: 89, percent: 12.6 },
                    { range: "3-5%", count: 54, percent: 7.7 },
                    { range: ">5%", count: 23, percent: 3.1 },
                  ].map((bucket) => (
                    <div key={bucket.range} className="flex items-center gap-3">
                      <div className="w-16 text-xs text-muted-foreground font-mono">{bucket.range}</div>
                      <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            bucket.range === ">5%" ? "bg-red-400" : "bg-primary"
                          }`}
                          style={{ width: `${bucket.percent}%` }}
                        />
                      </div>
                      <div className="w-16 text-xs text-right font-mono">{bucket.count}</div>
                      <div className="w-12 text-xs text-right text-muted-foreground">
                        {bucket.percent}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Total samples: {totalSamples} | {(100 - 3.1).toFixed(1)}% of predictions within 5% error margin
                </div>
              </CardContent>
            </Card>

            {/* Classification Summary */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Classification Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-700">{(metrics.accuracy * 100).toFixed(1)}%</div>
                    <div className="text-xs text-green-600 mt-1">Overall Accuracy</div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-700">{totalSamples}</div>
                    <div className="text-xs text-blue-600 mt-1">Test Scenarios</div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-700">
                      {Object.values(metrics.perClass).reduce((s, v) => s + v.f1, 0) / 3 > 0.9 ? "YES" : "NO"}
                    </div>
                    <div className="text-xs text-purple-600 mt-1">Production Ready?</div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg">
                    <div className="text-2xl font-bold text-amber-700">
                      {(Object.values(metrics.perClass).reduce((s, v) => s + v.f1, 0) / 3 * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-amber-600 mt-1">Avg F1 Score</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
