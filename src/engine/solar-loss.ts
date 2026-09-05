/**
 * Context-Aware Solar Loss Engine
 *
 * Computes solar performance loss metrics with night/twilight compensation.
 * Prevents false anomaly alarms during dark cycles by suppressing loss
 * calculations when the sun is not meaningfully available.
 *
 * Mathematical corrections ensure:
 * - Night/dusk hours → 0% loss baseline, "Idle (Sun Set)" state
 * - Cloud-edge spikes → clamped to prevent negative loss values
 * - Valid sunlight hours → explicit loss % calculation
 */

// ── Solar Geometry Constants ────────────────────────────────────────
const DEG_TO_RAD = Math.PI / 180;
const EARTH_AXIAL_TILT = 23.45;
const SOLAR_NOON_HOUR = 12;

// ── Night/Twilight Thresholds ──────────────────────────────────────
const NIGHT_START_HOUR = 18.5; // 18:30 — civil twilight ends
const NIGHT_END_HOUR = 6.0;    // 06:00 — civil twilight begins
const MIN_irradiance_THRESHOLD = 5; // W/m² — below this, sun is functionally absent

export interface SolarLossInput {
  /** Current timestamp (Date object or ISO string) */
  currentTime: Date | string;
  /** Actual power output from the system in kW */
  actualOutputKw: number;
  /** Expected power output from the PVWatts model in kW */
  expectedOutputKw: number;
  /** Site latitude in degrees (-90 to 90) */
  latitude: number;
  /** Site longitude in degrees (-180 to 180) */
  longitude: number;
  /** Whether a physical irradiance sensor is installed */
  hasPhysicalIrradianceSensor: boolean;
  /** Optional: measured irradiance from sensor in W/m² */
  measuredIrradianceWm2?: number;
}

export interface SolarLossMetrics {
  /** Whether the system is currently in a dark cycle */
  isDarkCycle: boolean;
  /** Operational state label */
  operationalState:
    | "Idle (Sun Set)"
    | "Idle (Night)"
    | "Active (Generating)"
    | "Active (Low Light)";
  /** Solar altitude angle in degrees (0 = horizon, negative = below) */
  solarAltitudeDeg: number;
  /** Loss percentage (0-100). 0% during dark cycles. */
  lossPercent: number;
  /** Absolute power loss in kW */
  lossKw: number;
  /** Whether any alert should be suppressed */
  suppressAlert: boolean;
  /** Human-readable reason for the operational state */
  reason: string;
  /** Hour angle used for solar position calculation */
  hourAngleDeg: number;
}

/**
 * Computes solar declination angle for a given day of year.
 * Spencer (1971) formula.
 */
function solarDeclination(dayOfYear: number): number {
  return EARTH_AXIAL_TILT * Math.sin(DEG_TO_RAD * (360 / 365) * (dayOfYear - 81));
}

/**
 * Computes the hour angle from local solar time.
 * Returns degrees. Negative = morning, positive = afternoon.
 */
function hourAngle(localSolarTimeHours: number): number {
  return (localSolarTimeHours - SOLAR_NOON_HOUR) * 15;
}

/**
 * Computes solar altitude angle (elevation above horizon).
 * Returns degrees. Positive = sun visible, negative = below horizon.
 */
function solarAltitude(latitudeDeg: number, declinationDeg: number, hourAngleDeg: number): number {
  const latRad = latitudeDeg * DEG_TO_RAD;
  const decRad = declinationDeg * DEG_TO_RAD;
  const haRad = hourAngleDeg * DEG_TO_RAD;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);

  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG_TO_RAD;
}

/**
 * Converts a Date to approximate local solar time (hours since midnight).
 * Uses longitude to correct from UTC. Simplified equation of time.
 */
function toLocalSolarTime(date: Date, longitudeDeg: number): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;

  // Equation of time correction (simplified, minutes)
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );
  const B = ((360 / 365) * (dayOfYear - 81)) * DEG_TO_RAD;
  const eotMinutes = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Longitude correction (4 minutes per degree from prime meridian)
  const lonCorrectionMinutes = longitudeDeg * 4;

  const localSolarTimeMinutes = utcHours * 60 + eotMinutes + lonCorrectionMinutes;
  return ((localSolarTimeMinutes % 1440) + 1440) % 1440 / 60;
}

/**
 * Core function: Computes context-aware solar loss metrics.
 *
 * During valid sunlight hours:
 *   lossPercent = ((expected - actual) / expected) * 100
 *   Clamped to [0, 100] to handle cloud-edge generation spikes.
 *
 * During dark cycles (night/twilight):
 *   lossPercent = 0, state = "Idle (Sun Set)", all alerts suppressed.
 */
export function computeSolarLossMetrics(input: SolarLossInput): SolarLossMetrics {
  const {
    currentTime,
    actualOutputKw,
    expectedOutputKw,
    latitude,
    longitude,
    hasPhysicalIrradianceSensor,
    measuredIrradianceWm2,
  } = input;

  // ── Step 1: Determine if we're in a dark cycle ────────────────────
  const date = currentTime instanceof Date ? currentTime : new Date(currentTime);
  const localSolarTime = toLocalSolarTime(date, longitude);
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );

  const declination = solarDeclination(dayOfYear);
  const ha = hourAngle(localSolarTime);
  const altitude = solarAltitude(latitude, declination, ha);

  // ── Step 2: Determine operational state ───────────────────────────
  let isDarkCycle = false;
  let operationalState: SolarLossMetrics["operationalState"] = "Active (Generating)";
  let suppressAlert = false;
  let reason = "";

  // Check by hour first (fast path)
  const hourFrac = localSolarTime;
  const isNightByHour = hourFrac < NIGHT_END_HOUR || hourFrac >= NIGHT_START_HOUR;

  // Check by solar altitude (geometric truth)
  const isNightByAltitude = altitude < -6; // Below civil twilight
  const isTwilight = altitude >= -6 && altitude < 10; // Civil twilight zone

  // Check by irradiance if sensor available
  const isDarkByIrradiance =
    hasPhysicalIrradianceSensor &&
    typeof measuredIrradianceWm2 === "number" &&
    measuredIrradianceWm2 < MIN_irradiance_THRESHOLD;

  // Composite dark cycle detection
  if (isNightByHour || isNightByAltitude || isDarkByIrradiance) {
    isDarkCycle = true;
    suppressAlert = true;

    if (hourFrac < 5 || hourFrac >= 20) {
      operationalState = "Idle (Night)";
      reason = `Local solar time ${hourFrac.toFixed(1)}h is deep night. Sun altitude: ${altitude.toFixed(1)}°.`;
    } else {
      operationalState = "Idle (Sun Set)";
      reason = `Sun altitude ${altitude.toFixed(1)}° is below operational threshold. Civil twilight ends at -6°.`;
    }
  } else if (isTwilight) {
    // Twilight: generate but suppress fault alerts
    isDarkCycle = false;
    operationalState = "Active (Low Light)";
    suppressAlert = true; // Suppress anomalies during twilight
    reason = `Sun altitude ${altitude.toFixed(1)}° is in twilight zone. Low-light generation active.`;
  } else {
    // Full daylight
    operationalState = "Active (Generating)";
    reason = `Sun altitude ${altitude.toFixed(1)}° at local solar time ${hourFrac.toFixed(1)}h. Full generation expected.`;
  }

  // ── Step 3: Compute loss metrics ──────────────────────────────────
  let lossPercent = 0;
  let lossKw = 0;

  if (!isDarkCycle) {
    // Valid sunlight hours: explicit loss calculation
    if (expectedOutputKw > 0) {
      const rawLoss = ((expectedOutputKw - actualOutputKw) / expectedOutputKw) * 100;

      // Clamp to prevent negative loss from cloud-edge spikes
      // (actual > expected due to transient cloud-edge enhancement)
      lossPercent = Math.max(0, Math.min(100, rawLoss));
      lossKw = Math.max(0, expectedOutputKw - actualOutputKw);
    } else {
      // If expected is 0 but we're in daylight, something is wrong with the model
      lossPercent = 0;
      lossKw = 0;
    }
  }
  // During dark cycles: lossPercent and lossKw remain 0 (no false alarms)

  return {
    isDarkCycle,
    operationalState,
    solarAltitudeDeg: Math.round(altitude * 100) / 100,
    lossPercent: Math.round(lossPercent * 100) / 100,
    lossKw: Math.round(lossKw * 1000) / 1000,
    suppressAlert,
    reason,
    hourAngleDeg: ha,
  };
}
