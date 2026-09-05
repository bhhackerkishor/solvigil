import { ISolarInstallation } from "@/models/SolarInstallation";
import { calculateExpectedPVWatts, PVWattsInput } from "./pvwatts";
import { extractFeatures, classify } from "./classifier";
import { getPeerGroupConsensus, PeerGroupResult } from "./peer-group";
import { fetchSatelliteIrradiance, SatelliteIrradianceData } from "@/lib/openmeteo";

export const ENGINE_VERSION = "1.1.0";

export interface DiagnosticInput {
  installation: ISolarInstallation;
  currentPowerKw: number;
  voltageVolts: number;
  currentAmperes: number;
  dailyKwhAccumulated: number;
  inverterTempCelsius: number;
  sensorIrradianceWm2?: number;
  previousExpectedPowerKw?: number; // Optional EMA state for smoothing
}

export interface DiagnosticOutput {
  expectedPowerKw: number;
  expectedPowerEmaKw: number;
  performanceRatio: number;
  faultCategory: string;
  faultConfidence: number;
  lossKw: number;
  pvModelDetails:object;
  estimatedDailyFinancialLossINR: number;
  alertMessage: string;
  alertColor: "green" | "blue" | "yellow" | "red" | "gray";
  peerGroup: PeerGroupResult;
  satelliteData: SatelliteIrradianceData;
  processingTimeMs: number;
}

export async function runDiagnostic(input: DiagnosticInput): Promise<DiagnosticOutput> {
  const startTime = Date.now();
  const { installation, sensorIrradianceWm2 } = input;

  // 1. Fetch satellite irradiance
  const satelliteData = await fetchSatelliteIrradiance(
    installation.location.latitude,
    installation.location.longitude
  );

  const hasHardwareSensor = installation.hardwareIntegration?.hasPhysicalIrradianceSensor ?? false;
  const isSensorReadingValid = typeof sensorIrradianceWm2 === "number" && sensorIrradianceWm2 >= 0;
  const usePhysicalSensor = hasHardwareSensor && isSensorReadingValid;

  const effectiveGhi = usePhysicalSensor ? sensorIrradianceWm2! : satelliteData.ghi;
  const irradianceSource = usePhysicalSensor ? "on-site-sensor" : (satelliteData.source || "open-meteo");

  // 2. High-Precision Physics Model Input
  const pvInput: PVWattsInput = {
    latitude: installation.location.latitude,
    longitude: installation.location.longitude,
    panelCount: installation.panelSpecs.panelCount,
    panelWattage: installation.panelSpecs.individualPanelWattage,
    totalArea: installation.panelSpecs.totalAreaSqMeters,
    panelEfficiency: installation.panelSpecs.panelEfficiencyPercentage / 100,
    tiltAngle: installation.panelSpecs.tiltAngle,
    azimuthAngle: installation.panelSpecs.azimuthAngle,
    inverterEfficiency: installation.inverterSpecs.efficiency / 100,
    inverterMaxKw: installation.inverterSpecs.maxCapacityKw,
    noct: installation.panelSpecs.noct || 45,
    ghi: effectiveGhi,
    dni: satelliteData.dni,
    ambientTemp: satelliteData.ambientTemp,
    windSpeedMps: (satelliteData as any).windSpeed || 2.0,
    mountingType: "ROOF_MOUNT",
    timestamp: new Date(),
    systemLosses: 0.14,
  };

  const pvResult = calculateExpectedPVWatts(pvInput);
  const actualPowerKw = input.currentPowerKw > 100 ? input.currentPowerKw / 1000 : input.currentPowerKw;
  const rawExpectedPowerAc = pvResult.expectedPowerAc;

  // 3. Exponential Moving Average (EMA) Noise Smoothing
  const alpha = 0.3; // 30% current frame, 70% historical smoothing
  const prevEma = input.previousExpectedPowerKw ?? rawExpectedPowerAc;
  const expectedPowerEmaKw = Math.round((alpha * rawExpectedPowerAc + (1 - alpha) * prevEma) * 1000) / 1000;

  const performanceRatio = expectedPowerEmaKw > 0
    ? Math.round((actualPowerKw / expectedPowerEmaKw) * 100) / 100
    : 0;

  // 4. Peer-group consensus
  const peerGroup = await getPeerGroupConsensus(
    installation._id.toString(),
    installation.location.latitude,
    installation.location.longitude
  );

  // 5. Feature extraction & classification
  const features = extractFeatures({
    actualPowerKw: input.currentPowerKw,
    expectedPowerKw: expectedPowerEmaKw,
    ghi: satelliteData.ghi,
    clearSkyGhi: 950,
    peerAveragePR: peerGroup.consensusPR,
    peerCount: peerGroup.peerCount,
    recentPRHistory: [performanceRatio],
    hourlyDropPattern: false,
    inverterTemp: input.inverterTempCelsius,
    voltageVolts: input.voltageVolts,
    nominalVoltage: 380,
  });

  const classification = classify(features);

  // 6. Loss calculation using smoothed EMA expected power
  const lossKw = Math.max(0, expectedPowerEmaKw - actualPowerKw);
  const INR_PER_KWH = 6.5;
  const PEAK_HOURS = 5.0; // Standard daily peak sun hours
  const estimatedDailyFinancialLossINR = Math.round(lossKw * PEAK_HOURS * INR_PER_KWH);

  // 7. Alert generation
  const { alertMessage, alertColor } = generateAlert(
    classification.faultCategory,
    classification.confidence,
    performanceRatio,
    peerGroup,
    estimatedDailyFinancialLossINR
  );

  const processingTimeMs = Date.now() - startTime;

  if (performanceRatio > 1.20) {
  return {
    expectedPowerKw: rawExpectedPowerAc,
    expectedPowerEmaKw,
    performanceRatio,
    faultCategory: "SENSOR_CALIBRATION",
    faultConfidence: 0.90,
    lossKw: 0,
    estimatedDailyFinancialLossINR: 0,
    pvModelDetails: {
      cellTemperature: pvResult.cellTemperature,
      moduleTemperature: pvResult.cellTemperature,
      aoiDegrees: pvResult.intermediate?.incidenceAngle || 0,
      transpositionFactor: pvResult.intermediate?.transpositionFactor || 1,
      isClipping: pvResult.inverterClipping || false,
      clippingLossKw: pvResult.clippingLoss || 0,
      derateFactors: {
        thermal: pvResult.derateFactors?.thermal ?? 1,
        inverter: pvResult.derateFactors?.inverter ?? 0.96,
        soiling: pvResult.derateFactors?.soiling ?? 1,
      },
      aoiLossFraction: pvResult.aoiLoss || 0,
    },
    alertMessage: `Anomalous performance ratio (${(performanceRatio * 100).toFixed(0)}%). Verify timestamp sync or kW unit scaling.`,
    alertColor: "yellow",
    peerGroup,
    satelliteData: { ...satelliteData, ghi: effectiveGhi, source: irradianceSource },
    processingTimeMs,
  };
}

  return {
    expectedPowerKw: rawExpectedPowerAc,
    expectedPowerEmaKw,
    performanceRatio,
    faultCategory: classification.faultCategory,
    faultConfidence: classification.confidence,
    lossKw: Math.round(lossKw * 1000) / 1000,
    estimatedDailyFinancialLossINR,
    alertMessage,
    alertColor,
    peerGroup,
    pvModelDetails: {
      cellTemperature: pvResult.cellTemperature,
      moduleTemperature: pvResult.cellTemperature,
      aoiDegrees: pvResult.intermediate?.incidenceAngle || 0,
      transpositionFactor: pvResult.intermediate?.transpositionFactor || 1,
      isClipping: pvResult.inverterClipping || false,
      clippingLossKw: pvResult.clippingLoss || 0,
      derateFactors: {
        thermal: pvResult.derateFactors?.thermal ?? 1,
        inverter: pvResult.derateFactors?.inverter ?? 0.96,
        soiling: pvResult.derateFactors?.soiling ?? 1,
      },
      aoiLossFraction: pvResult.aoiLoss || 0,
    },
    satelliteData: {
      ...satelliteData,
      ghi: effectiveGhi,
      source: irradianceSource,
    },
    processingTimeMs,
  };
}

function generateAlert(
  category: string,
  confidence: number,
  pr: number,
  peerGroup: PeerGroupResult,
  lossINR: number
): { alertMessage: string; alertColor: "green" | "blue" | "yellow" | "red" | "gray" } {
  const prPercent = (pr * 100).toFixed(0);
  const yieldDrop = Math.max(0, 100 - Math.round(pr * 100));
  switch (category) {
    case "OPTIMAL":
      return {
        alertMessage: "Array operating normally. Performance ratio is healthy.",
        alertColor: "green",
      };
    case "WEATHER_AFFECTED":
      return {
        alertMessage: `Generation down due to local cloud cover. All ${peerGroup.peerCount} nearby arrays show similar pattern. No action needed.`,
        alertColor: "blue",
      };
    case "SOILING_ALERT":
      return {
        alertMessage: `SOILING ALERT: Steady dust accumulation causing ~${yieldDrop}% yield drop. Wash panels to recover ~₹${lossINR * 7}/week. Confidence: ${(confidence * 100).toFixed(0)}%.`,
        alertColor: "yellow",
      };
    case "HARDWARE_FAULT":
      return {
        alertMessage: `HARDWARE FAULT: Localized drop detected under clear sky (PR: ${prPercent}%). Nearest peers at ${(peerGroup.consensusPR * 100).toFixed(0)}%. Inspect panels, bypass diodes, or inverter. Confidence: ${(confidence * 100).toFixed(0)}%.`,
        alertColor: "red",
      };
    default:
      return {
        alertMessage: `Performance below expected (PR: ${prPercent}%). Monitoring for pattern development.`,
        alertColor: "gray",
      };
  }
}