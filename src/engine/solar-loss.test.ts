/**
 * Testing Suite for Context-Aware Solar Loss Engine
 *
 * Validates the engine across three explicit execution tracks:
 * 1. Peak Noon Solar Activity (Defective Output / High Loss)
 * 2. Peak Noon Solar Activity (Normal Output / Healthy)
 * 3. Late Night 21:00 Hours (Zero Output / Idle)
 *
 * Run: npx ts-node --esm src/engine/solar-loss.test.ts
 * Or import and call runSolarLossTests() from any entry point.
 */

import { computeSolarLossMetrics, type SolarLossInput, type SolarLossMetrics } from "./solar-loss";

// ── Test Utilities ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, testName: string, details?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}${details ? ` — ${details}` : ""}`);
  }
}

function assertRange(
  value: number,
  min: number,
  max: number,
  testName: string
) {
  assert(value >= min && value <= max, testName, `got ${value}, expected [${min}, ${max}]`);
}

function sectionHeader(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

// ── Scenario 1: Peak Noon — Defective Output (High Loss) ───────────

function testPeakNoonDefective() {
  sectionHeader("Scenario 1: Peak Noon — Defective Output / High Loss");

  // Simulate: 12:30 PM local solar time, New Delhi (28.61°N, 77.21°E)
  // Panel generating only 1.2 kW out of expected 4.5 kW = severe fault
  const input: SolarLossInput = {
    currentTime: new Date("2026-06-15T07:00:00Z"), // 12:30 IST ≈ 07:00 UTC
    actualOutputKw: 1.2,
    expectedOutputKw: 4.5,
    latitude: 28.6139,
    longitude: 77.209,
    hasPhysicalIrradianceSensor: false,
  };

  const result = computeSolarLossMetrics(input);

  assert(result.isDarkCycle === false, "Should NOT be dark cycle at noon");
  assert(result.operationalState === "Active (Generating)", `State should be Active (Generating), got: ${result.operationalState}`);
  assert(result.solarAltitudeDeg > 30, `Solar altitude should be high at noon, got: ${result.solarAltitudeDeg}°`);
  assert(result.suppressAlert === false, "Should NOT suppress alerts during daylight");

  // Loss calculation: ((4.5 - 1.2) / 4.5) * 100 = 73.33%
  assertRange(result.lossPercent, 70, 80, "Loss should be ~73% (high loss scenario)");
  assertRange(result.lossKw, 3.2, 3.4, "Loss kW should be ~3.3 kW");

  // Verify alert suppression is OFF — this is a real fault
  assert(result.suppressAlert === false, "Alert should be active for daytime faults");
  assert(result.reason.includes("Full generation expected"), `Reason mentions full generation: ${result.reason}`);
}

// ── Scenario 2: Peak Noon — Normal Output (Healthy) ────────────────

function testPeakNoonHealthy() {
  sectionHeader("Scenario 2: Peak Noon — Normal Output / Healthy");

  // Simulate: 12:00 PM local solar time, New Delhi
  // Panel generating 4.2 kW out of expected 4.5 kW = healthy (93% PR)
  const input: SolarLossInput = {
    currentTime: new Date("2026-06-15T06:30:00Z"), // ~12:00 IST
    actualOutputKw: 4.2,
    expectedOutputKw: 4.5,
    latitude: 28.6139,
    longitude: 77.209,
    hasPhysicalIrradianceSensor: true,
    measuredIrradianceWm2: 920,
  };

  const result = computeSolarLossMetrics(input);

  assert(result.isDarkCycle === false, "Should NOT be dark cycle at noon");
  assert(result.operationalState === "Active (Generating)", `State: ${result.operationalState}`);
  assert(result.solarAltitudeDeg > 30, `Solar altitude high at noon: ${result.solarAltitudeDeg}°`);
  assert(result.suppressAlert === false, "Should NOT suppress alerts");

  // Loss: ((4.5 - 4.2) / 4.5) * 100 = 6.67% (acceptable)
  assertRange(result.lossPercent, 5, 10, "Loss should be ~6.7% (healthy)");
  assertRange(result.lossKw, 0.28, 0.32, "Loss kW should be ~0.3 kW");

  assert(result.suppressAlert === false, "Alert active — small loss is normal monitoring");
}

// ── Scenario 3: Late Night 21:00 — Zero Output (Idle) ─────────────

function testLateNightIdle() {
  sectionHeader("Scenario 3: Late Night 21:00 — Zero Output / Idle");

  // Simulate: 21:00 local time, New Delhi — well past sunset
  // Actual = 0, Expected = 0 → should NOT trigger any alarm
  const input: SolarLossInput = {
    currentTime: new Date("2026-06-15T15:30:00Z"), // 21:00 IST
    actualOutputKw: 0,
    expectedOutputKw: 0,
    latitude: 28.6139,
    longitude: 77.209,
    hasPhysicalIrradianceSensor: false,
  };

  const result = computeSolarLossMetrics(input);

  assert(result.isDarkCycle === true, "Should be dark cycle at 21:00");
  assert(
    result.operationalState === "Idle (Night)" || result.operationalState === "Idle (Sun Set)",
    `State should be Idle, got: ${result.operationalState}`
  );
  assert(result.solarAltitudeDeg < 0, `Solar altitude should be negative at night: ${result.solarAltitudeDeg}°`);
  assert(result.suppressAlert === true, "CRITICAL: Should suppress all alerts at night");
  assert(result.lossPercent === 0, `Loss should be 0% at night, got: ${result.lossPercent}%`);
  assert(result.lossKw === 0, `Loss kW should be 0 at night, got: ${result.lossKw}`);
}

// ── Scenario 4: Early Morning Twilight (Edge Case) ─────────────────

function testEarlyMorningTwilight() {
  sectionHeader("Scenario 4: Early Morning Twilight — Edge Case");

  // Simulate: ~05:30 local time, just before civil twilight
  const input: SolarLossInput = {
    currentTime: new Date("2026-03-21T00:00:00Z"), // ~05:30 IST in March
    actualOutputKw: 0.1,
    expectedOutputKw: 0.5,
    latitude: 28.6139,
    longitude: 77.209,
    hasPhysicalIrradianceSensor: true,
    measuredIrradianceWm2: 8,
  };

  const result = computeSolarLossMetrics(input);

  // At 05:30, should be near twilight boundary
  assert(
    result.isDarkCycle === true || result.operationalState === "Active (Low Light)",
    `Should be dark or low-light at 05:30, got: ${result.operationalState}`
  );
  // Loss alerts should be suppressed in either case
  assert(result.suppressAlert === true, "Alerts suppressed during twilight/night");
}

// ── Scenario 5: Cloud-Edge Spike (Negative Loss Prevention) ────────

function testCloudEdgeSpike() {
  sectionHeader("Scenario 5: Cloud-Edge Spike — Negative Loss Clamped");

  // Cloud-edge enhancement: actual (5.1 kW) > expected (4.5 kW)
  // Raw loss would be negative — must be clamped to 0%
  const input: SolarLossInput = {
    currentTime: new Date("2026-06-15T06:30:00Z"), // noon
    actualOutputKw: 5.1,
    expectedOutputKw: 4.5,
    latitude: 28.6139,
    longitude: 77.209,
    hasPhysicalIrradianceSensor: false,
  };

  const result = computeSolarLossMetrics(input);

  assert(result.isDarkCycle === false, "Daytime — not dark cycle");
  assert(result.lossPercent === 0, `Cloud-edge spike: loss clamped to 0%, got: ${result.lossPercent}%`);
  assert(result.lossKw === 0, `Cloud-edge spike: loss kW = 0, got: ${result.lossKw}`);
  assert(result.suppressAlert === false, "Not dark — but no fault to alert on");
}

// ── Scenario 6: Southern Hemisphere — Midnight Sun Edge ────────────

function testSouthernHemisphere() {
  sectionHeader("Scenario 6: Southern Hemisphere — Summer Noon");

  // Sydney, Australia (−33.87°S) in December (summer)
  const input: SolarLossInput = {
    currentTime: new Date("2026-12-21T02:00:00Z"), // ~13:00 AEDT
    actualOutputKw: 2.8,
    expectedOutputKw: 3.2,
    latitude: -33.8688,
    longitude: 151.2093,
    hasPhysicalIrradianceSensor: false,
  };

  const result = computeSolarLossMetrics(input);

  assert(result.isDarkCycle === false, "Summer noon in Sydney — not dark");
  assert(result.operationalState === "Active (Generating)", `State: ${result.operationalState}`);
  assert(result.solarAltitudeDeg > 20, `Sun should be high: ${result.solarAltitudeDeg}°`);

  // Loss: ((3.2 - 2.8) / 3.2) * 100 = 12.5%
  assertRange(result.lossPercent, 10, 15, "Loss ~12.5%");
}

// ── Scenario 7: Sensor-Based Night Detection ───────────────────────

function testSensorBasedNightDetection() {
  sectionHeader("Scenario 7: Sensor-Based Night Detection");

  // Even if hour suggests daylight, sensor reads 0 W/m² → trust the sensor
  const input: SolarLossInput = {
    currentTime: new Date("2026-06-15T06:30:00Z"), // noon UTC
    actualOutputKw: 0,
    expectedOutputKw: 4.5,
    latitude: 28.6139,
    longitude: 77.209,
    hasPhysicalIrradianceSensor: true,
    measuredIrradianceWm2: 0, // Sensor says: no sun
  };

  const result = computeSolarLossMetrics(input);

  // Sensor reading 0 → treated as dark cycle regardless of time calculation
  assert(result.suppressAlert === true, "Sensor-based detection: suppress alerts when irradiance = 0");
  assert(result.lossPercent === 0, "Sensor says night: loss = 0%");
}

// ── Run All Tests ───────────────────────────────────────────────────

export function runSolarLossTests() {
  console.log("\n☀️  SolVigil Solar Loss Engine — Test Suite\n");

  testPeakNoonDefective();
  testPeakNoonHealthy();
  testLateNightIdle();
  testEarlyMorningTwilight();
  testCloudEdgeSpike();
  testSouthernHemisphere();
  testSensorBasedNightDetection();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${"═".repeat(60)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Auto-run if executed directly
if (typeof require !== "undefined" && require.main === module) {
  runSolarLossTests();
}
