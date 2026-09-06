/**
 * PVWatts-Inspired Solar Performance Model with Sandia Thermal & Dynamic Inverter Curves
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type MountingType = "OPEN_RACK" | "ROOF_MOUNT" | "INSULATED_BACK";

const SANDIA_COEFFS: Record<MountingType, { a: number; b: number; deltaT: number }> = {
  OPEN_RACK: { a: -3.47, b: -0.0594, deltaT: 3 },
  ROOF_MOUNT: { a: -2.98, b: -0.0471, deltaT: 1 },
  INSULATED_BACK: { a: -2.81, b: -0.0455, deltaT: 0 },
};

export interface SolarPosition {
  solarAltitude: number;
  solarAzimuth: number;
  zenithAngle: number;
  hourAngle: number;
}

export interface PVWattsInput {
  latitude: number;
  longitude: number;
  panelCount: number;
  panelWattage: number;
  totalArea: number;           // m²
  panelEfficiency: number;     // fraction (0-1)
  tiltAngle: number;           // degrees from horizontal
  azimuthAngle: number;        // degrees from north (180 = south)
  inverterEfficiency: number;  // baseline rating fraction (0-1)
  inverterMaxKw: number;
  noct: number;
  ghi: number;                 // W/m²
  dni: number;                 // W/m²
  ambientTemp: number;         // °C
  windSpeedMps?: number;       // m/s from Open-Meteo
  mountingType?: MountingType; // Mounting structure
  lastCleanedDate?: Date;      // Cleaning or heavy rainfall timestamp
  timestamp: Date;
  systemLosses?: number;
}

export interface PVWattsOutput {
  expectedPowerDc: number;
  expectedPowerAc: number;
  cellTemperature: number;
  aoiLoss: number;
  temperatureLoss: number;
  inverterClipping: boolean;
  clippingLoss: number;
  totalSystemLoss: number;
  derateFactors: {
    thermal: number;
    inverter: number;
    soiling: number;
  };
  intermediate: {
    solarPosition: SolarPosition;
    incidenceAngle: number;
    transpositionFactor: number;
  };
}

// ── Solar Position & AOI Calculations ─────────────────────────────────

function solarDeclination(dayOfYear: number): number {
  return 23.45 * Math.sin(DEG_TO_RAD * (360 / 365) * (dayOfYear - 81));
}

function hourAngle(localSolarTimeHours: number): number {
  return (localSolarTimeHours - 12) * 15;
}

export function computeSolarPosition(
  latitude: number,
  dayOfYear: number,
  hourAngleDeg: number
): SolarPosition {
  const latRad = latitude * DEG_TO_RAD;
  const decl = solarDeclination(dayOfYear) * DEG_TO_RAD;
  const haRad = hourAngleDeg * DEG_TO_RAD;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD_TO_DEG;
  const zenith = 90 - altitude;

  const cosAzDenominator = Math.cos(latRad) * Math.cos(altitude * DEG_TO_RAD);
  
  // Guard against division by zero or near-zero values near the poles or horizons
  const cosAzRaw = cosAzDenominator === 0 
    ? 0 
    : (Math.sin(decl) - Math.sin(latRad) * sinAlt) / cosAzDenominator;
    
  // CRITICAL FIX: Clamp the ratio strictly between -1 and 1 to prevent Math.acos from yielding NaN
  const cosAzClamped = Math.max(-1, Math.min(1, cosAzRaw));
  
  let azimuthFromSouth = Math.acos(cosAzClamped) * RAD_TO_DEG;
  if (hourAngleDeg > 0) azimuthFromSouth = 360 - azimuthFromSouth;

  const azimuth = (azimuthFromSouth + 180) % 360;

  return {
    solarAltitude: altitude,
    solarAzimuth: azimuth,
    zenithAngle: zenith,
    hourAngle: hourAngleDeg,
  };
}


export function computeAOI(
  zenithDeg: number,
  solarAzimuth: number,
  panelTilt: number,
  panelAzimuth: number
): number {
  const zenRad = zenithDeg * DEG_TO_RAD;
  const tiltRad = panelTilt * DEG_TO_RAD;
  const deltaAz = (solarAzimuth - panelAzimuth) * DEG_TO_RAD;

  const cosAOI =
    Math.cos(zenRad) * Math.cos(tiltRad) +
    Math.sin(zenRad) * Math.sin(tiltRad) * Math.cos(deltaAz);

  return Math.acos(Math.max(-1, Math.min(1, cosAOI))) * RAD_TO_DEG;
}

export function aoiLossFraction(aoiDeg: number): number {
  if (aoiDeg >= 85) return 1.0;
  if (aoiDeg <= 0) return 0.0;
  const b0 = 0.05;
  const cosAOI = Math.cos(aoiDeg * DEG_TO_RAD);
  const modifier = 1 - b0 * (1 / cosAOI - 1);
  return 1 - Math.max(0, Math.min(1, modifier));
}

// ── Physics Models (Sandia, Inverter Curve, Soiling) ─────────────────

export function calculateSandiaCellTemperature(
  ghi: number,
  ambTempC: number,
  windSpeedMps: number = 2.0,
  mounting: MountingType = "ROOF_MOUNT"
): { moduleTempC: number; cellTempC: number; thermalDerate: number } {
  if (ghi <= 0) {
    return { moduleTempC: ambTempC, cellTempC: ambTempC, thermalDerate: 1.0 };
  }

  const coeffs = SANDIA_COEFFS[mounting];
  const moduleTempC = ghi * Math.exp(coeffs.a + coeffs.b * windSpeedMps) + ambTempC;
  const cellTempC = moduleTempC + (ghi / 1000.0) * coeffs.deltaT;
  const thermalDerate = 1.0 + (-0.0038) * (cellTempC - 25.0);

  return { moduleTempC, cellTempC, thermalDerate };
}

export function calculateDynamicInverterEfficiency(
  dcPowerKw: number,
  maxCapacityKw: number
): number {
  if (dcPowerKw <= 0 || maxCapacityKw <= 0) return 0;
  const loadRatio = Math.min(1.0, dcPowerKw / maxCapacityKw);
  if (loadRatio < 0.02) return 0.70;

  const eta = 0.982 - 0.015 * Math.pow(loadRatio - 0.6, 2) - (0.02 / loadRatio);
  return Math.max(0.70, Math.min(0.985, eta));
}

export function calculateSoilingFactor(lastCleanedDate?: Date): number {
  if (!lastCleanedDate) return 0.96;
  const diffTime = Math.abs(new Date().getTime() - new Date(lastCleanedDate).getTime());
  const daysPassed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0.85, 1.0 - daysPassed * 0.002);
}

// Update the function signature to accept explicit dhi instead of computing kt proxies
export function computeGTI(
  ghi: number,
  dni: number,
  dhi: number, // Added explicit Diffuse Horizontal Irradiance parameter
  aoiDeg: number,
  tiltDeg: number,
  groundReflectance: number = 0.2
): number {
  const tiltRad = tiltDeg * DEG_TO_RAD;
  const aoiRad = aoiDeg * DEG_TO_RAD;

  // Direct component hitting the tilted panel face
  const directComponent = dni * Math.max(0, Math.cos(aoiRad));
  
  // Sky diffuse component using the actual DHI value scaled by sky view factor
  const diffuseComponent = dhi * ((1 + Math.cos(tiltRad)) / 2);
  
  // Ground reflected albedo component
  const groundReflected = ghi * groundReflectance * ((1 - Math.cos(tiltRad)) / 2);

  return directComponent + diffuseComponent + groundReflected;
}


// ── Main Diagnostic Calculation ──────────────────────────────────────

export function calculateExpectedPVWatts(input: PVWattsInput): PVWattsOutput {
  const date = new Date(input.timestamp);
  const dayOfYear = getDayOfYear(date);
  const solarTime = getLocalSolarTime(date, input.longitude,dayOfYear);

  const haDeg = hourAngle(solarTime);
  const solarPos = computeSolarPosition(input.latitude, dayOfYear, haDeg);

  const aoiDeg = computeAOI(
    solarPos.zenithAngle,
    solarPos.solarAzimuth,
    
    input.tiltAngle,
    input.azimuthAngle
  );

  const gtiWm2 = computeGTI(input.ghi, input.dni, aoiDeg,(input as any).dhi || (input.ghi - (input.dni * Math.cos(solarPos.zenithAngle * DEG_TO_RAD))), input.tiltAngle);
  const effectiveIrradianceRatio = gtiWm2 / 1000;

  const dcNameplateKw = (input.panelCount * input.panelWattage) / 1000;

  // 1. Sandia Cell Temperature & Derate
  const { cellTempC, thermalDerate } = calculateSandiaCellTemperature(
    input.ghi,
    input.ambientTemp,
    input.windSpeedMps ?? 2.0,
    input.mountingType ?? "ROOF_MOUNT"
  );

  // 2. Soiling Derate
  const soilingDerate = calculateSoilingFactor(input.lastCleanedDate);

  // 3. AOI Loss
  const aoiLoss = aoiLossFraction(aoiDeg);

  // 4. Calculate DC Power
  const systemLosses = input.systemLosses ?? 0.14;
  const dcPowerKw =
    dcNameplateKw *
    effectiveIrradianceRatio *
    thermalDerate *
    soilingDerate *
    (1 - aoiLoss) *
    (1 - systemLosses);

  // 5. Dynamic Inverter Efficiency Calculation
  const dynamicInverterEta = calculateDynamicInverterEfficiency(
    dcPowerKw,
    input.inverterMaxKw
  );

  let acPowerKw = dcPowerKw * dynamicInverterEta;
  const inverterClipping = acPowerKw > input.inverterMaxKw;
  
  let clippingLoss = 0;
  if (inverterClipping) {
    clippingLoss = acPowerKw - input.inverterMaxKw;
    acPowerKw = input.inverterMaxKw;
  }

  const totalLoss = 1 - thermalDerate * soilingDerate * (1 - aoiLoss) * (1 - systemLosses);

  return {
    expectedPowerDc: Math.max(0, Math.round(dcPowerKw * 1000) / 1000),
    expectedPowerAc: Math.max(0, Math.round(acPowerKw * 1000) / 1000),
    cellTemperature: Math.round(cellTempC * 10) / 10,
    aoiLoss: Math.round(aoiLoss * 1000) / 1000,
    temperatureLoss: Math.round((1 - thermalDerate) * 1000) / 1000,
    inverterClipping,
    clippingLoss: Math.round(clippingLoss * 1000) / 1000,
    totalSystemLoss: Math.round(totalLoss * 1000) / 1000,
    derateFactors: {
      thermal: Math.round(thermalDerate * 1000) / 1000,
      inverter: Math.round(dynamicInverterEta * 1000) / 1000,
      soiling: Math.round(soilingDerate * 1000) / 1000,
    },
    intermediate: {
      solarPosition: solarPos,
      incidenceAngle: Math.round(aoiDeg * 100) / 100,
      transpositionFactor: Math.round((gtiWm2 / Math.max(input.ghi, 1)) * 1000) / 1000,
    },
  };
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime() + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getLocalSolarTime(date: Date, longitude: number ,dayOfYear:number): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const b = (360 / 365) * (dayOfYear - 81) * (Math.PI / 180);
const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
const solarTime = utcHours + (longitude / 15) + (eot / 60);

  return ((solarTime % 24) + 24) % 24;
}