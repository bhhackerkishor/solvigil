/**
 * SolVigil Telemetry Simulator
 *
 * Simulates a real solar inverter posting live metrics to the telemetry stream API.
 * Includes realistic diurnal patterns, cloud transients, soiling degradation,
 * and random hardware fault injection.
 *
 * Usage:
 *   node simulate-telemetry.js
 *   node simulate-telemetry.js --api-key YOUR_KEY --interval 5000
 */

const API_URL = "http://localhost:3000/api/v1/telemetry/stream";

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const API_KEY = getArg("--api-key", "49d86066-2b28-4240-9968-6506dcb022fd");
const INTERVAL_MS = parseInt(getArg("--interval", "5000"), 10);
const SIM_DAYS = parseFloat(getArg("--days", "0.5")); // fraction of day per run
const SCENARIO = getArg("--scenario", "normal");      // normal | soiling | fault | cloud

// ── Solar physics constants ───────────────────────────────────────────
const PANEL_COUNT = 10;
const PANEL_WATTAGE = 500;
const EFFICIENCY = 0.20;
const INVERTER_EFF = 0.96;
const PANEL_AREA = PANEL_COUNT * PANEL_WATTAGE * 0.004; // m²
const PEAK_SUN_HOUR = 12; // solar noon

// ── Scenario: soiling degradation (dust accumulates over days) ────────
let soilingFactor = 1.0;
if (SCENARIO === "soiling") {
  soilingFactor = 0.78; // 22% loss from dust
}

// ── Scenario: hardware fault (sudden step drop) ───────────────────────
const FAULT_ACTIVE = SCENARIO === "fault";

// ── Scenario: cloud cover ─────────────────────────────────────────────
const HEAVY_CLOUD = SCENARIO === "cloud";

// ── Utility helpers ───────────────────────────────────────────────────
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function gaussianRandom(mean, stddev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stddev;
}

// ── Hour-of-day solar irradiance model (clear sky) ────────────────────
// Bell curve peaking at solar noon, 0 before 6am and after 6pm
function clearSkyGHI(hourOfDay) {
  if (hourOfDay < 5.5 || hourOfDay > 18.5) return 0;
  const center = PEAK_SUN_HOUR;
  const sigma = 3.5;
  const raw = Math.exp(-0.5 * ((hourOfDay - center) / sigma) ** 2);
  return raw * 950; // peak ~950 W/m²
}

// ── Cloud transient generator ─────────────────────────────────────────
// Simulates intermittent cloud passing that drops GHI temporarily
function cloudFilter(ghi, hourOfDay) {
  if (HEAVY_CLOUD) return ghi * 0.35 + gaussianRandom(0, 15);
  // Random cloud cells passing every ~45 minutes during midday
  if (hourOfDay > 8 && hourOfDay < 16) {
    const cloudCycle = Math.sin(hourOfDay * 1.7) * 0.5 + 0.5;
    if (cloudCycle > 0.7) return ghi * 0.5 + gaussianRandom(0, 20);
  }
  return ghi + gaussianRandom(0, 5);
}

// ── Calculate expected DC power ───────────────────────────────────────
function expectedPower(ghi, dni) {
  const tiltRad = (20 * Math.PI) / 180;
  const gti = Math.max(
    (ghi / 1000) * Math.cos(tiltRad) + (dni / 1000) * Math.sin(tiltRad) * 0.85,
    (ghi / 1000) * 0.15
  );
  return PANEL_AREA * gti * EFFICIENCY * INVERTER_EFF;
}

// ── Simulate telemetry payload ────────────────────────────────────────
function generateTelemetry(hourOfDay, minuteOfHour) {
  const fractionalHour = hourOfDay + minuteOfHour / 60;

  // Satellite irradiance
  let ghi = clearSkyGHI(fractionalHour);
  ghi = cloudFilter(ghi, fractionalHour);
  ghi = Math.max(0, ghi + gaussianRandom(0, 8));

  const dni = ghi * 0.75 + gaussianRandom(0, 10);

  // Expected power from physics model
  const pExpected = expectedPower(ghi, dni);

  // Actual power with sensor noise and soiling/fault applied
  let noiseFactor = gaussianRandom(1.0, 0.015); // 1.5% sensor noise
  let actualPower = pExpected * noiseFactor * soilingFactor;

  if (FAULT_ACTIVE && hourOfDay >= 10 && hourOfDay <= 14) {
    // Partial panel failure during peak hours
    actualPower *= 0.45;
  }

  actualPower = Math.max(0, actualPower);

  const voltage = 380 + gaussianRandom(0, 2); // DC bus ~380V
  const current = actualPower > 0 ? (actualPower * 1000) / voltage : 0;
  const ambientTemp = 28 + 4 * Math.sin((fractionalHour - 6) * Math.PI / 12) + gaussianRandom(0, 1);
  const inverterTemp = ambientTemp + actualPower * 3.5 + gaussianRandom(0, 0.5);

  // Daily accumulator (simplified: energy since sunrise)
  const peakHoursElapsed = Math.max(0, fractionalHour - 6) / 12;
  const dailyKwh = actualPower * peakHoursElapsed * 8;

  return {
    currentPowerKw: Math.round(actualPower * 1000) / 1000,
    voltageVolts: Math.round(voltage * 10) / 10,
    currentAmperes: Math.round(current * 100) / 100,
    dailyKwhAccumulated: Math.round(dailyKwh * 100) / 100,
    inverterTempCelsius: Math.round(inverterTemp * 10) / 10,
    sensorIrradianceWm2: undefined, // optional physical sensor
  };
}

// ── Send telemetry to SolVigil ────────────────────────────────────────
async function sendTelemetry(payload) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`[ERROR] ${res.status}: ${data.error}`);
      return null;
    }

    return data;
  } catch (err) {
    console.error(`[NETWORK ERROR] ${err.message}`);
    return null;
  }
}

// ── Pretty-print diagnostic result ────────────────────────────────────
function printDiagnostic(data) {
  const ts = new Date(data.timestamp).toLocaleTimeString();
  const t = data.telemetry;
  const d = data.diagnostic;
  const s = data.satellite;

  const colorMap = {
    green: "\x1b[32m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    gray: "\x1b[90m",
  };
  const reset = "\x1b[0m";
  const color = colorMap[d.alertColor] || "";

  console.log(
    `\n${color}━━━ ${ts} ━━━${reset}\n` +
    `  Output:      ${t.currentPowerKw.toFixed(2)} kW  |  ` +
    `Voltage: ${t.voltageVolts}V  |  Current: ${t.currentAmperes}A\n` +
    `  Satellite:   GHI ${s.ghi.toFixed(0)} W/m²  |  ` +
    `DNI ${s.dni.toFixed(0)} W/m²  |  Temp ${s.ambientTemp.toFixed(1)}°C\n` +
    `  Expected:    ${d.expectedPowerKw.toFixed(2)} kW  |  ` +
    `PR: ${(d.performanceRatio * 100).toFixed(1)}%  |  ` +
    `Loss: ${d.lossKw.toFixed(2)} kW\n` +
    `  ${color}${d.faultCategory}: ${d.alertMessage}${reset}\n` +
    `  Financial Loss: ₹${d.estimatedDailyFinancialLossINR}/day`
  );
}

// ── Main simulation loop ──────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║       SolVigil Telemetry Simulator           ║");
  console.log("╠═══════════════════════════════════════════════╣");
  console.log(`║  API Key:    ${API_KEY.slice(0, 12)}...`);
  console.log(`║  Interval:   ${INTERVAL_MS}ms`);
  console.log(`║  Scenario:   ${SCENARIO}`);
  console.log(`║  Duration:   ~${(SIM_DAYS * 24).toFixed(1)} hours simulated`);
  console.log("╚═══════════════════════════════════════════════╝\n");

  const totalSteps = Math.ceil((SIM_DAYS * 24 * 60) / (INTERVAL_MS / 1000));
  let simMinute = 0;

  for (let step = 0; step < totalSteps; step++) {
    const hour = Math.floor(simMinute / 60) % 24;
    const minute = simMinute % 60;

    const payload = generateTelemetry(hour, minute);
    const result = await sendTelemetry(payload);

    if (result && result.diagnostic) {
      printDiagnostic(result);
    }

    // Advance simulation time
    simMinute += Math.ceil(INTERVAL_MS / 1000);

    // Wait real interval
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  console.log("\n[DONE] Simulation complete.");
}

main().catch(console.error);
