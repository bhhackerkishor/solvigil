/**
 * Advanced Solar Physics & Thermal Diagnostic Engine
 */

export type MountingType = "OPEN_RACK" | "ROOF_MOUNT" | "INSULATED_BACK";

export interface SystemSpecs {
  stcCapacityKw: number;        // Nominal DC Capacity under STC (1000 W/m², 25°C)
  panelTiltDeg: number;         // Installation tilt angle (e.g., 15°)
  tempCoeffPmax: number;        // Pmax temperature coefficient (%/°C, typically -0.35 to -0.45)
  mounting: MountingType;       // Mounting configuration
  inverterRatedPowerKw: number; // Rated inverter AC output capacity
  lastCleanedDate?: Date;       // Date of last cleaning or heavy rainfall
}

export interface TelemetryFrame {
  timestamp: Date;
  rawInputPowerKw: number;      // Instantaneous AC Power measured by inverter/meter
  ghi: number;                  // Global Horizontal Irradiance (W/m²) from Open-Meteo
  ambTempC: number;             // Ambient Air Temperature (°C) from Open-Meteo
  windSpeedMps: number;         // Wind Speed at 10m (m/s) from Open-Meteo
  tariffRateINR?: number;       // Grid electricity tariff (₹/kWh)
  previousEmaExpectedKw?: number; // Previous frame's EMA expected power for filtering
}

export interface DiagnosticResult {
  expectedPowerAcKw: number;    // Highly accurate expected AC power output
  expectedPowerEmaKw: number;   // Smoothed expected AC power (eliminates false alerts)
  cellTempC: number;            // Calculated silicon junction temperature
  lossKw: number;               // Real instantaneous AC power loss
  dailyFinancialLossINR: number;// Projected daily revenue loss
  derateFactors: {
    thermal: number;            // Sandia temperature efficiency factor
    inverter: number;           // Load-dependent inverter efficiency
    soiling: number;            // Dust accumulation factor
  };
}

// Sandia Model Mounting Constants
const SANDIA_COEFFS: Record<MountingType, { a: number; b: number; deltaT: number }> = {
  OPEN_RACK: { a: -3.47, b: -0.0594, deltaT: 3 },
  ROOF_MOUNT: { a: -2.98, b: -0.0471, deltaT: 1 },
  INSULATED_BACK: { a: -2.81, b: -0.0455, deltaT: 0 },
};

/**
 * 1. Computes Silicon Junction Temperature using the Sandia PV Array Model
 */
export function calculateCellTemperature(
  ghi: number,
  ambTempC: number,
  windSpeedMps: number,
  mounting: MountingType
): { moduleTempC: number; cellTempC: number; thermalDerate: number } {
  if (ghi <= 0) {
    return { moduleTempC: ambTempC, cellTempC: ambTempC, thermalDerate: 1.0 };
  }

  const coeffs = SANDIA_COEFFS[mounting];
  
  // T_m = GHI * exp(a + b * WindSpeed) + T_amb
  const moduleTempC = ghi * Math.exp(coeffs.a + coeffs.b * windSpeedMps) + ambTempC;
  
  // T_cell = T_m + (GHI / 1000) * deltaT
  const cellTempC = moduleTempC + (ghi / 1000.0) * coeffs.deltaT;
  
  // Temperature derate relative to 25°C STC standard
  const thermalDerate = 1.0 + (-0.38 / 100.0) * (cellTempC - 25.0);

  return { moduleTempC, cellTempC, thermalDerate };
}

/**
 * 2. Computes Dynamic Inverter Efficiency based on operating load ratio
 * Uses a quadratic loss model: Efficiency drops significantly at low loading (<10%)
 */
export function calculateInverterEfficiency(dcPowerKw: number, ratedCapacityKw: number): number {
  if (dcPowerKw <= 0 || ratedCapacityKw <= 0) return 0;

  const loadRatio = Math.min(1.0, dcPowerKw / ratedCapacityKw);
  if (loadRatio < 0.02) return 0.70; // High internal tare loss at minimal light

  // Empirical quadratic efficiency loss curve for commercial string inverters
  // Peak efficiency (~98.2%) occurs around 50%-70% load
  const eta = 0.982 - 0.015 * Math.pow(loadRatio - 0.6, 2) - (0.02 / loadRatio);
  
  return Math.max(0.70, Math.min(0.985, eta));
}

/**
 * 3. Computes Soiling Loss factor based on days since last cleaning/rain
 */
export function calculateSoilingFactor(lastCleanedDate?: Date): number {
  if (!lastCleanedDate) return 0.96; // Default 4% standard atmospheric dust loss

  const now = new Date();
  const diffTime = Math.abs(now.getTime() - lastCleanedDate.getTime());
  const daysPassed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Soiling degrades by ~0.2% per day without cleaning, capped at 15% maximum loss
  const degradation = Math.min(0.15, daysPassed * 0.002);
  return 1.0 - degradation;
}

/**
 * Main Multi-Stage Processing Pipeline
 */
export function processSolarTelemetry(
  specs: SystemSpecs,
  telemetry: TelemetryFrame
): DiagnosticResult {
  const { ghi, ambTempC, windSpeedMps, rawInputPowerKw } = telemetry;
  const tariff = telemetry.tariffRateINR ?? 5.5; // Default ₹5.5/kWh tariff

  // Nighttime check
  if (ghi < 5) {
    return {
      expectedPowerAcKw: 0,
      expectedPowerEmaKw: 0,
      cellTempC: ambTempC,
      lossKw: 0,
      dailyFinancialLossINR: 0,
      derateFactors: { thermal: 1.0, inverter: 0, soiling: 1.0 },
    };
  }

  // --- STAGE 1: Thermal Derate via Sandia Model ---
  const { cellTempC, thermalDerate } = calculateCellTemperature(
    ghi,
    ambTempC,
    windSpeedMps,
    specs.mounting
  );

  // --- STAGE 2: Soiling Loss Derate ---
  const soilingDerate = calculateSoilingFactor(specs.lastCleanedDate);

  // --- STAGE 3: Calculate Expected Intermediate DC Power ---
  const uncorrectedDcKw = specs.stcCapacityKw * (ghi / 1000.0);
  const expectedDcPowerKw = uncorrectedDcKw * thermalDerate * soilingDerate;

  // --- STAGE 4: Dynamic Inverter AC Efficiency Conversion ---
  const inverterEfficiency = calculateInverterEfficiency(
    expectedDcPowerKw,
    specs.inverterRatedPowerKw
  );
  
  const expectedPowerAcKw = expectedDcPowerKw * inverterEfficiency;

  // --- STAGE 5: Exponential Moving Average (EMA) Noise Smoothing ---
  // Smooths satellite interpolation jumps using alpha = 0.3 (30% new, 70% history)
  const alpha = 0.3;
  const prevEma = telemetry.previousEmaExpectedKw ?? expectedPowerAcKw;
  const expectedPowerEmaKw = alpha * expectedPowerAcKw + (1 - alpha) * prevEma;

  // --- STAGE 6: Deficit & Financial Loss Calculation ---
  // Compare raw measured AC input against the smoothed expected AC power
  const lossKw = Math.max(0, expectedPowerEmaKw - rawInputPowerKw);

  // Project over effective peak sun hours (standard 5.0 hours/day baseline)
  const peakSunHours = 5.0;
  const dailyFinancialLossINR = Math.round(lossKw * peakSunHours * tariff);

  return {
    expectedPowerAcKw: Number(expectedPowerAcKw.toFixed(3)),
    expectedPowerEmaKw: Number(expectedPowerEmaKw.toFixed(3)),
    cellTempC: Number(cellTempC.toFixed(2)),
    lossKw: Number(lossKw.toFixed(3)),
    dailyFinancialLossINR,
    derateFactors: {
      thermal: Number(thermalDerate.toFixed(4)),
      inverter: Number(inverterEfficiency.toFixed(4)),
      soiling: Number(soilingDerate.toFixed(4)),
    },
  };
}