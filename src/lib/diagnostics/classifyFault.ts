/**
 * Regional Peer-Consensus Fault Classifier
 *
 * Compares the target plant's Performance Ratio against the regional
 * peer-group average to disambiguate local faults from weather events.
 *
 * Decision Logic:
 *   PR >= 0.80                                  → OPTIMAL
 *   PR < 0.70 AND regional PR < 0.70            → WEATHER_AFFECTED (false-alarm suppressed)
 *   PR < 0.70 AND regional PR >= 0.80 AND GHI > 600:
 *       Gradual degradation over 5+ cycles      → SOILING_ALERT
 *       Instant drop / power == 0               → HARDWARE_FAULT
 *
 * Financial Loss calculated at ₹6.5/kWh commercial tariff.
 */

const INR_PER_KWH = 6.5;
const PEAK_SUN_HOURS_PER_DAY = 8;
const TEMP_COEFF_PER_C = -0.004;
const STC_TEMP = 25;
const ANNUAL_DEGRADATION = 0.005;

export type FaultCategory =
  | "OPTIMAL"
  | "WEATHER_AFFECTED"
  | "SOILING_ALERT"
  | "HARDWARE_FAULT"
  | "UNKNOWN";

export interface ClassifierInput {
  currentPlantPR: number;
  regionalAveragePR: number;
  ghi: number;               // W/m²
  cellTemp: number;           // °C
  currentPowerKw: number;
  expectedPowerKw: number;
  prHistory?: number[];       // recent PR values (newest last) for trend detection
  plantCapacityKw: number;   // installed capacity
}

export interface ClassifierResult {
  category: FaultCategory;
  confidence: number;
  reasoning: string;
  financialLossINR: number;
  recommendedAction: string;
}

/**
 * Core classifier: takes plant telemetry + peer context and returns
 * a fault classification with confidence, reasoning, and financial impact.
 */
export function classifyFault(input: ClassifierInput): ClassifierResult {
  const {
    currentPlantPR,
    regionalAveragePR,
    ghi,
    cellTemp,
    currentPowerKw,
    expectedPowerKw,
    prHistory = [],
    plantCapacityKw,
  } = input;

  const lossKw = Math.max(0, expectedPowerKw - currentPowerKw);
  const financialLossINR = Math.round(lossKw * PEAK_SUN_HOURS_PER_DAY * INR_PER_KWH);

  // ── RULE 1: Healthy Performance ─────────────────────────────────────
  if (currentPlantPR >= 0.80) {
    return {
      category: "OPTIMAL",
      confidence: clampConfidence(0.90 + (currentPlantPR - 0.80) * 0.5),
      reasoning:
        `Performance Ratio is ${(currentPlantPR * 100).toFixed(1)}%, above the 80% threshold. ` +
        `Array is operating within expected parameters under current irradiance of ${ghi.toFixed(0)} W/m².`,
      financialLossINR: 0,
      recommendedAction: "No action required. Continue regular monitoring.",
    };
  }

  // ── RULE 2: Regional Weather Event ──────────────────────────────────
  // If both this plant AND the regional peers are degraded together,
  // it's a weather event — suppress false alarm.
  if (currentPlantPR < 0.70 && regionalAveragePR < 0.70) {
    const peerGap = Math.abs(currentPlantPR - regionalAveragePR);
    const confidence = 0.75 + peerGap * 0.5; // closer to peer PR = higher confidence

    return {
      category: "WEATHER_AFFECTED",
      confidence: clampConfidence(confidence),
      reasoning:
        `Performance Ratio is ${(currentPlantPR * 100).toFixed(1)}% but regional peer ` +
        `average is also at ${(regionalAveragePR * 100).toFixed(1)}%. ` +
        `This indicates a regional weather event (cloud cover / rain) affecting all arrays. ` +
        `GHI is ${ghi.toFixed(0)} W/m² (below clear-sky threshold of 600 W/m²). ` +
        `False fault alert suppressed.`,
      financialLossINR: 0, // weather losses are not actionable
      recommendedAction:
        "No corrective action needed. Generation will recover when weather clears. " +
        "Monitor for PR recovery in next clear-sky period.",
    };
  }

  // ── RULE 3: Local Fault Under Clear Sky ─────────────────────────────
  // PR is low but regional peers are healthy AND irradiance is adequate.
  // This is a local issue — determine if soiling (gradual) or hardware (instant).
  if (currentPlantPR < 0.70 && regionalAveragePR >= 0.80 && ghi > 600) {
    const hasGradualDegradation = detectGradualDegradation(prHistory);
    const hasInstantDrop = detectInstantDrop(prHistory) || currentPowerKw === 0;

    // Sub-rule 3a: Instantaneous drop → hardware fault
    if (hasInstantDrop || currentPowerKw === 0) {
      const confidence = currentPowerKw === 0 ? 0.95 : 0.82;
      return {
        category: "HARDWARE_FAULT",
        confidence: clampConfidence(confidence),
        reasoning:
          `Performance Ratio dropped to ${(currentPlantPR * 100).toFixed(1)}% instantaneously ` +
          `while regional peers are healthy at ${(regionalAveragePR * 100).toFixed(1)}%. ` +
          `Irradiance is adequate (${ghi.toFixed(0)} W/m²). ` +
          `${currentPowerKw === 0 ? "Power output is ZERO — possible inverter shutdown, " +
            "bypass diode failure, or complete string disconnection." :
            "Sudden step-function drop indicates micro-crack, hot spot, or diode failure."}`,
        financialLossINR,
        recommendedAction:
          currentPowerKw === 0
            ? "URGENT: Inspect inverter status, check DC disconnects, verify string voltages. " +
              "Possible inverter trip or MPPT failure."
            : "Inspect panels for visible damage (micro-cracks, hot spots). " +
              "Check bypass diode status. Perform IV-curve trace on affected string.",
      };
    }

    // Sub-rule 3b: Gradual degradation → soiling
    if (hasGradualDegradation) {
      const degradationSeverity = Math.round((1 - currentPlantPR) * 100);
      return {
        category: "SOILING_ALERT",
        confidence: clampConfidence(0.80),
        reasoning:
          `Performance Ratio has steadily declined to ${(currentPlantPR * 100).toFixed(1)}% ` +
          `over ${prHistory.length}+ measurement cycles while regional peers remain at ` +
          `${(regionalAveragePR * 100).toFixed(1)}%. ` +
          `Irradiance is strong at ${ghi.toFixed(0)} W/m², ruling out weather. ` +
          `Gradual degradation pattern is consistent with dust/soiling accumulation ` +
          `causing ~${degradationSeverity}% yield loss.`,
        financialLossINR,
        recommendedAction:
          `Schedule panel cleaning. Estimated recoverable loss: ₹${financialLossINR}/day ` +
          `(₹${financialLossINR * 7}/week). Priority: ${degradationSeverity > 20 ? "HIGH" : "MEDIUM"}.`,
      };
    }

    // Fallback: low PR, peers healthy, but pattern unclear
    return {
      category: "UNKNOWN",
      confidence: 0.50,
      reasoning:
        `Performance Ratio is ${(currentPlantPR * 100).toFixed(1)}% while regional peers are at ` +
        `${(regionalAveragePR * 100).toFixed(1)}%. Irradiance is ${ghi.toFixed(0)} W/m². ` +
        `Insufficient history to distinguish between soiling and hardware fault. ` +
        `Continued monitoring required.`,
      financialLossINR,
      recommendedAction:
        "Monitor closely over next 24-48 hours. If degradation continues gradually → soiling. " +
        "If sudden change → hardware fault. Collect additional data points.",
    };
  }

  // ── FALLBACK ────────────────────────────────────────────────────────
  return {
    category: "UNKNOWN",
    confidence: 0.40,
    reasoning:
      `PR is ${(currentPlantPR * 100).toFixed(1)}%, regional peer average is ` +
      `${(regionalAveragePR * 100).toFixed(1)}%, GHI is ${ghi.toFixed(0)} W/m². ` +
      `No classification rule matched with sufficient confidence.`,
    financialLossINR,
    recommendedAction: "Continue monitoring. Collect more data for pattern analysis.",
  };
}

/**
 * Simple physics-based expected power calculator for the classifier.
 * P_expected = Capacity × (GHI/1000) × (1 - max(0, Temp-25) × 0.004) × (1 - Age × 0.005)
 */
export function calculateExpectedPower(
  capacityKw: number,
  ghiWm2: number,
  ambientTempC: number,
  ageYears: number = 0,
  inverterEfficiency: number = 0.96
): number {
  const irradianceFactor = ghiWm2 / 1000;
  const tempDerating = 1 - Math.max(0, ambientTempC - STC_TEMP) * Math.abs(TEMP_COEFF_PER_C);
  const ageDerating = 1 - ageYears * ANNUAL_DEGRADATION;
  return capacityKw * irradianceFactor * tempDerating * ageDerating * inverterEfficiency;
}

/**
 * Calculate Performance Ratio from actual vs expected power.
 */
export function calculatePR(actualPowerKw: number, expectedPowerKw: number): number {
  if (expectedPowerKw <= 0) return 0;
  return Math.min(1, actualPowerKw / expectedPowerKw);
}

/**
 * Temperature derating percentage for display purposes.
 */
export function temperatureDeratingPercent(cellTempC: number): number {
  return Math.max(0, (cellTempC - STC_TEMP) * Math.abs(TEMP_COEFF_PER_C) * 100);
}

/**
 * Age-based degradation percentage for display.
 */
export function ageDegradationPercent(years: number): number {
  return years * ANNUAL_DEGRADATION * 100;
}

// ── Trend Detection Helpers ───────────────────────────────────────────

/**
 * Detects gradual degradation: 5+ consecutive declining PR values.
 */
function detectGradualDegradation(prHistory: number[]): boolean {
  if (prHistory.length < 5) return false;
  const recent = prHistory.slice(-5);
  let decliningCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] < recent[i - 1]) decliningCount++;
  }
  return decliningCount >= 4; // 4 out of 5 transitions are declining
}

/**
 * Detects instant step-function drop: >20% PR drop between consecutive readings.
 */
function detectInstantDrop(prHistory: number[]): boolean {
  if (prHistory.length < 2) return false;
  for (let i = 1; i < prHistory.length; i++) {
    const drop = prHistory[i - 1] - prHistory[i];
    if (drop > 0.20) return true;
  }
  return false;
}

function clampConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}
