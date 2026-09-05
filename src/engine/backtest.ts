/**
 * Backtesting Harness for Disambiguation Engine
 *
 * Generates synthetic telemetry scenarios with known fault injections,
 * runs them through the full pipeline, and validates that the engine
 * correctly classifies each scenario.
 *
 * This is the validation approach without physical hardware:
 * simulate known faults → verify engine flags them correctly.
 */

import { calculateExpectedPVWatts, PVWattsInput } from "./pvwatts";
import { extractFeatures, classify, FeatureSet } from "./classifier";

const BASE_LAT = 28.6139;  // New Delhi
const BASE_LNG = 77.209;

interface ScenarioResult {
  scenarioName: string;
  expectedCategory: string;
  actualCategory: string;
  confidence: number;
  passed: boolean;
  pr: number;
}

/**
 * Generates a base PVWatts input for testing.
 */
function baseInput(overrides: Partial<PVWattsInput> = {}): PVWattsInput {
  return {
    latitude: BASE_LAT,
    longitude: BASE_LNG,
    panelCount: 10,
    panelWattage: 500,
    totalArea: 20,
    panelEfficiency: 0.20,
    tiltAngle: 20,
    azimuthAngle: 180,
    inverterEfficiency: 0.96,
    inverterMaxKw: 5,
    noct: 45,
    ghi: 800,
    dni: 600,
    ambientTemp: 30,
    timestamp: new Date("2026-03-15T12:00:00Z"),
    systemLosses: 0.14,
    ...overrides,
  };
}

/**
 * Runs a single backtesting scenario.
 */
function runScenario(
  name: string,
  expectedCategory: string,
  pvInput: PVWattsInput,
  actualPowerKw: number,
  peerAveragePR: number,
  peerCount: number,
  prHistory: number[],
  hourlyDropPattern: boolean = false
): ScenarioResult {
  const pvResult = calculateExpectedPVWatts(pvInput);

  // Compute clear-sky GHI for the same conditions
  const clearSkyInput = baseInput({ ghi: 950, dni: 700 });
  const clearSkyResult = calculateExpectedPVWatts(clearSkyInput);

  const features = extractFeatures({
    actualPowerKw,
    expectedPowerKw: pvResult.expectedPowerAc,
    ghi: pvInput.ghi,
    clearSkyGhi: 950,
    peerAveragePR,
    peerCount,
    recentPRHistory: prHistory,
    hourlyDropPattern,
    inverterTemp: 45,
    voltageVolts: 380,
    nominalVoltage: 380,
  });

  const result = classify(features);

  return {
    scenarioName: name,
    expectedCategory,
    actualCategory: result.faultCategory,
    confidence: result.confidence,
    passed: result.faultCategory === expectedCategory,
    pr: features.expectedPowerKw > 0 ? features.actualPowerKw / features.expectedPowerKw : 0,
  };
}

// ── Scenario Definitions ──────────────────────────────────────────────

export function runBacktestSuite(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  // 1. OPTIMAL: full output under clear sky
  results.push(
    runScenario(
      "Clear sky, full output",
      "OPTIMAL",
      baseInput({ ghi: 850, dni: 650 }),
      4.2,     // actual power (kW)
      0.90,    // peer PR
      5,       // peer count
      [0.88, 0.90, 0.89, 0.91, 0.90, 0.89, 0.90], // stable 7-day history
      false
    )
  );

  // 2. WEATHER_AFFECTED: low GHI, peers also down
  results.push(
    runScenario(
      "Heavy cloud cover",
      "WEATHER_AFFECTED",
      baseInput({ ghi: 250, dni: 100 }),
      0.8,
      0.55,
      4,
      [0.60, 0.55, 0.58, 0.62, 0.50, 0.58, 0.55],
      false
    )
  );

  // 3. SOILING_ALERT: clear sky, peers healthy, steady degradation
  results.push(
    runScenario(
      "Soiling after dust storm",
      "SOILING_ALERT",
      baseInput({ ghi: 820, dni: 620 }),
      2.8,
      0.88,
      4,
      [0.85, 0.82, 0.79, 0.76, 0.73, 0.70, 0.68],
      false
    )
  );

  // 4. HARDWARE_FAULT: clear sky, severe drop, same-hour pattern
  results.push(
    runScenario(
      "Bypass diode failure",
      "HARDWARE_FAULT",
      baseInput({ ghi: 850, dni: 650 }),
      1.5,
      0.90,
      4,
      [0.89, 0.90, 0.45, 0.44, 0.43, 0.45, 0.44], // sudden step-drop at specific hour
      true
    )
  );

  // 5. HARDWARE_FAULT: partial shading from new obstacle
  results.push(
    runScenario(
      "New building shadow at noon",
      "HARDWARE_FAULT",
      baseInput({ ghi: 850, dni: 650 }),
      2.0,
      0.89,
      3,
      [0.88, 0.89, 0.55, 0.54, 0.55, 0.54, 0.55],
      true
    )
  );

  // 6. SOILING: moderate degradation (early stage)
  results.push(
    runScenario(
      "Early-stage soiling",
      "SOILING_ALERT",
      baseInput({ ghi: 800, dni: 600 }),
      3.2,
      0.87,
      5,
      [0.85, 0.83, 0.81, 0.79, 0.78, 0.77, 0.76],
      false
    )
  );

  // 7. WEATHER: intermittent rain
  results.push(
    runScenario(
      "Intermittent rain showers",
      "WEATHER_AFFECTED",
      baseInput({ ghi: 350, dni: 150 }),
      1.2,
      0.65,
      3,
      [0.70, 0.65, 0.72, 0.68, 0.60, 0.65, 0.63],
      false
    )
  );

  return results;
}

/**
 * Prints the backtest results in a readable format.
 */
export function printBacktestResults(results: ScenarioResult[]): void {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║           SolVigil Disambiguation Engine — Backtest Report     ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");

  let passed = 0;
  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    const status = r.passed ? "PASS" : "FAIL";
    console.log(
      `║ ${icon} ${status} │ ${r.scenarioName.padEnd(35)} │ ` +
      `Expected: ${r.expectedCategory.padEnd(18)} │ ` +
      `Got: ${r.actualCategory.padEnd(15)} │ ` +
      `PR: ${(r.pr * 100).toFixed(0)}% │ Conf: ${(r.confidence * 100).toFixed(0)}%`
    );
    if (r.passed) passed++;
  }

  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log(
    `║ Score: ${passed}/${results.length} scenarios passed ` +
    `(${((passed / results.length) * 100).toFixed(0)}% accuracy)`
  );
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
}

// ── Run if executed directly ──────────────────────────────────────────
if (require.main === module) {
  const results = runBacktestSuite();
  printBacktestResults(results);
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}
