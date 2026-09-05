import { ISolarInstallation } from "@/models/SolarInstallation";

export interface DiagnosticOutput {
  expectedPowerKw: number;
  performanceRatio: number;
  faultCategory: "OPTIMAL" | "WEATHER_AFFECTED" | "SOILING_ALERT" | "HARDWARE_FAULT" | "UNKNOWN";
  lossKw: number;
  estimatedDailyFinancialLossINR: number;
  alertMessage: string;
  alertColor: "green" | "blue" | "yellow" | "red" | "gray";
}

/**
 * Calculates the expected DC power output from a solar array under given irradiance.
 *
 * Formula:
 * P_expected (kW) = Total_Area (m2) x GTI (kW/m2) x Panel_Efficiency x Inverter_Efficiency
 *
 * GTI (Global Tilted Irradiance) accounts for panel tilt/azimuth orientation
 * relative to the sun's position. We approximate GTI from GHI using:
 * GTI = GHI x cos(tilt) + DNI x sin(tilt) x cos(azimuth_diff)
 */
export function calculateExpectedPower(
  installation: ISolarInstallation,
  ghiWm2: number,
  dniWm2: number
): number {
  const { panelSpecs, inverterSpecs } = installation;

  const tiltRad = (panelSpecs.tiltAngle * Math.PI) / 180;
  const azimuthRad = (panelSpecs.azimuthAngle * Math.PI) / 180;

  // Approximate GTI from GHI and DNI using plane-of-array transposition
  const ghiKwm2 = ghiWm2 / 1000;
  const dniKwm2 = dniWm2 / 1000;

  const cosTilt = Math.cos(tiltRad);
  const sinTilt = Math.sin(tiltRad);

  // Simplified transposition: assume sun azimuth ~180 deg (south) at solar noon
  const sunAzimuthDiff = azimuthRad - Math.PI;
  const cosAzimuthDiff = Math.cos(sunAzimuthDiff);

  // GTI = GHI * (diffuse + direct) transposition factor
  const gtiKwm2 = Math.max(
    ghiKwm2 * cosTilt + dniKwm2 * sinTilt * Math.abs(cosAzimuthDiff),
    ghiKwm2 * 0.15
  );

  // P_expected = Area x GTI x Efficiency x Inverter_Eff
  const panelEfficiency = panelSpecs.panelEfficiencyPercentage / 100;
  const inverterEfficiency = inverterSpecs.efficiency / 100;

  const pExpected =
    panelSpecs.totalAreaSqMeters * gtiKwm2 * panelEfficiency * inverterEfficiency;

  return Math.round(pExpected * 1000) / 1000;
}

/**
 * Calculates Performance Ratio (PR): ratio of actual to expected power output.
 * PR >= 0.85 is healthy; lower values indicate losses.
 */
export function calculatePerformanceRatio(actualPowerKw: number, expectedPowerKw: number): number {
  if (expectedPowerKw <= 0) return 0;
  return Math.round((actualPowerKw / expectedPowerKw) * 100) / 100;
}

/**
 * Determines the average PR of peer installations within a geographic radius.
 * Used for spatial peer-group consensus disambiguation.
 */
export function calculatePeerGroupConsensus(
  peerPRs: number[]
): { averagePR: number; peerCount: number; percentageDrop: number } {
  if (peerPRs.length === 0) {
    return { averagePR: 1.0, peerCount: 0, percentageDrop: 0 };
  }
  const avg = peerPRs.reduce((a, b) => a + b, 0) / peerPRs.length;
  const drop = Math.round((1 - avg) * 100);
  return { averagePR: Math.round(avg * 100) / 100, peerCount: peerPRs.length, percentageDrop: drop };
}

/**
 * Core Disambiguation Rules Engine.
 *
 * Combines Performance Ratio, satellite irradiance data, peer-group consensus,
 * and temporal degradation patterns to classify the fault category.
 *
 * Decision tree:
 * 1. PR >= 0.85 -> OPTIMAL
 * 2. PR < 0.70 AND low irradiance AND peers also down -> WEATHER_AFFECTED
 * 3. PR < 0.75 AND high irradiance AND peers healthy AND degraded over 7+ days -> SOILING_ALERT
 * 4. PR < 0.60 AND high irradiance AND sudden step-drop -> HARDWARE_FAULT
 * 5. Otherwise -> UNKNOWN
 */
export function disambiguateFault(
  actualPowerKw: number,
  expectedPowerKw: number,
  ghiWm2: number,
  peerAveragePR: number,
  recentPRHistory: number[]
): DiagnosticOutput {
  const performanceRatio = calculatePerformanceRatio(actualPowerKw, expectedPowerKw);
  const lossKw = Math.round((expectedPowerKw - actualPowerKw) * 1000) / 1000;

  // Approximate financial loss: INR 6.5 per kWh (average Indian solar tariff)
  const INR_PER_KWH = 6.5;
  const estimatedDailyFinancialLossINR = Math.round(lossKw * 8 * INR_PER_KWH);

  const peerPercentageDrop = Math.round((1 - peerAveragePR) * 100);

  // RULE 1: Healthy performance
  if (performanceRatio >= 0.85) {
    return {
      expectedPowerKw,
      performanceRatio,
      faultCategory: "OPTIMAL",
      lossKw: Math.max(0, lossKw),
      estimatedDailyFinancialLossINR: 0,
      alertMessage: "Array operating normally.",
      alertColor: "green",
    };
  }

  // RULE 2: Weather-affected (cloud cover, rain, haze)
  if (
    performanceRatio < 0.70 &&
    ghiWm2 < 400 &&
    peerPercentageDrop > 30
  ) {
    return {
      expectedPowerKw,
      performanceRatio,
      faultCategory: "WEATHER_AFFECTED",
      lossKw,
      estimatedDailyFinancialLossINR: 0,
      alertMessage: `Generation down ${peerPercentageDrop}% due to local cloud cover. No action needed.`,
      alertColor: "blue",
    };
  }

  // RULE 3: Soiling alert (dust/dirt accumulation)
  // Check for steady degradation over multiple days in clear sky conditions
  const hasSteadyDegradation = checkSteadyDegradation(recentPRHistory);
  if (
    performanceRatio < 0.75 &&
    ghiWm2 > 700 &&
    peerAveragePR > 0.85 &&
    hasSteadyDegradation
  ) {
    const yieldDropPercent = Math.round((1 - performanceRatio) * 100);
    const weeklyLossINR = estimatedDailyFinancialLossINR * 7;
    return {
      expectedPowerKw,
      performanceRatio,
      faultCategory: "SOILING_ALERT",
      lossKw,
      estimatedDailyFinancialLossINR,
      alertMessage: `SOILING ALERT: Dust accumulation causing ${yieldDropPercent}% yield drop. Wash panels to recover Rs.${weeklyLossINR}/week.`,
      alertColor: "yellow",
    };
  }

  // RULE 4: Hardware fault (sudden step-function drop, bypass diode, micro-crack)
  const hasSuddenDrop = checkSuddenStepDrop(recentPRHistory);
  if (
    performanceRatio < 0.60 &&
    ghiWm2 > 700 &&
    hasSuddenDrop
  ) {
    return {
      expectedPowerKw,
      performanceRatio,
      faultCategory: "HARDWARE_FAULT",
      lossKw,
      estimatedDailyFinancialLossINR,
      alertMessage: "HARDWARE FAULT: Severe localized drop detected under clear sky. Inspect panels/inverter.",
      alertColor: "red",
    };
  }

  // FALLBACK: Unknown degradation
  return {
    expectedPowerKw,
    performanceRatio,
    faultCategory: "UNKNOWN",
    lossKw,
    estimatedDailyFinancialLossINR,
    alertMessage: "Performance below expected. Monitoring for pattern development.",
    alertColor: "gray",
  };
}

/**
 * Checks if PR history shows steady degradation over 7+ data points.
 * Used to distinguish soiling (gradual) from hardware faults (sudden).
 */
function checkSteadyDegradation(prHistory: number[]): boolean {
  if (prHistory.length < 7) return false;

  const recent = prHistory.slice(-7);
  let degradationCount = 0;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i] < recent[i - 1]) {
      degradationCount++;
    }
  }

  // At least 5 out of 7 transitions show decline = steady degradation
  return degradationCount >= 5;
}

/**
 * Checks if PR history shows a sudden step-function drop.
 * A drop of > 20% between consecutive measurements indicates hardware issue.
 */
function checkSuddenStepDrop(prHistory: number[]): boolean {
  if (prHistory.length < 2) return false;

  for (let i = 1; i < prHistory.length; i++) {
    const drop = prHistory[i - 1] - prHistory[i];
    if (drop > 0.20) return true;
  }

  return false;
}

/**
 * Converts fractional hours of sunshine to approximate daily GHI estimate.
 * Fallback when real-time API data is unavailable.
 */
export function estimateDailyGHI(hourlyGhi: number[], sunshineHours: number): number {
  if (hourlyGhi.length === 0) return 0;
  const totalIrradiance = hourlyGhi.reduce((sum, val) => sum + val, 0);
  return totalIrradiance / Math.max(sunshineHours, 1);
}
