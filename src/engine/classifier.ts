export interface FeatureSet {
  actualPowerKw: number;
  expectedPowerKw: number;
  ghi: number;
  clearSkyGhi: number;
  peerAveragePR: number;
  peerCount: number;
  recentPRHistory: number[];
  hourlyDropPattern: boolean;
  inverterTemp: number;
  voltageVolts: number;
  nominalVoltage: number;
}

export interface ClassificationResult {
  faultCategory: "OPTIMAL" | "WEATHER_AFFECTED" | "SOILING_ALERT" | "HARDWARE_FAULT" | "UNKNOWN";
  confidence: number;
}

export function extractFeatures(input: {
  actualPowerKw: number;
  expectedPowerKw: number;
  ghi: number;
  clearSkyGhi: number;
  peerAveragePR: number;
  peerCount: number;
  recentPRHistory: number[];
  hourlyDropPattern: boolean;
  inverterTemp: number;
  voltageVolts: number;
  nominalVoltage: number;
}): FeatureSet {
  return { ...input };
}

export function classify(features: FeatureSet): ClassificationResult {
  const performanceRatio =
    features.expectedPowerKw > 0
      ? features.actualPowerKw / features.expectedPowerKw
      : 0;

  // 1. Low Irradiance/Night Check: Avoid false alerts when GHI is low (< 50 W/m²)
  if (features.ghi < 50) {
    return {
      faultCategory: "OPTIMAL",
      confidence: 1.0,
    };
  }

  // 2. OPTIMAL Range Check: PR between 0.90 and 1.10 is considered healthy array performance
  if (performanceRatio >= 0.90 && performanceRatio <= 1.10) {
    return {
      faultCategory: "OPTIMAL",
      confidence: 0.95,
    };
  }

  // 3. Weather/Cloud Cover Check: Low PR, but peer group shows similar drop
  if (
    performanceRatio < 0.90 &&
    features.peerCount > 0 &&
    Math.abs(performanceRatio - features.peerAveragePR) < 0.10
  ) {
    return {
      faultCategory: "WEATHER_AFFECTED",
      confidence: 0.85,
    };
  }

  // 4. HARDWARE FAULT Check: Severe drop (PR < 0.75) under high solar irradiance
  // evaluated BEFORE soiling to prevent severe drops from matching soiling first
  if (
    performanceRatio < 0.75 &&
    features.ghi >= 300 &&
    (features.peerCount === 0 || features.peerAveragePR > 0.85)
  ) {
    return {
      faultCategory: "HARDWARE_FAULT",
      confidence: 0.90,
    };
  }

  // 5. SOILING ALERT Check: Moderate drop (0.75 <= PR < 0.90) under clear sky
  if (
    performanceRatio >= 0.75 &&
    performanceRatio < 0.90 &&
    features.ghi >= 400 &&
    !features.hourlyDropPattern
  ) {
    return {
      faultCategory: "SOILING_ALERT",
      confidence: 0.80,
    };
  }

  // 6. Fallback for unclassified anomalies
  return {
    faultCategory: "UNKNOWN",
    confidence: 0.30,
  };
}