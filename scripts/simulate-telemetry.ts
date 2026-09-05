// scripts/simulate-telemetry.ts

// Configuration
const TARGET_API_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// Paste the raw plaintext API key generated during installation creation
const API_KEY = process.env.SOLVIGIL_API_KEY || "sv_68294f5a50d3cfa2b3ccf202e60d5c21cb92897a378bcaaf650405ae01e9c3f2";
const INTERVAL_SECONDS = 5; // Frequency of payload generation

// Simulation states: 'OPTIMAL' | 'SOILING' | 'CLOUDY' | 'HARDWARE_FAULT'
let currentScenario: "OPTIMAL" | "SOILING" | "CLOUDY" | "HARDWARE_FAULT" = "OPTIMAL";

interface TelemetryPayload {
  currentPowerKw: number;
  voltageVolts: number;
  currentAmperes: number;
  dailyKwhAccumulated: number;
  inverterTempCelsius: number;
  sensorIrradianceWm2?: number;
}

/**
 * Calculates realistic solar telemetry values based on solar position and selected fault scenario.
 */
function generateSimulatedTelemetry(scenario: typeof currentScenario): TelemetryPayload {
  const now = new Date();
  
  // UTC Hours decimal (e.g. 10:06 UTC -> 10.1)
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;

  // South India solar daylight window in UTC (approx 00:30 UTC sunrise to 12:30 UTC sunset)
  // Peak solar noon is around 06:30 UTC (~12:00 PM IST)
  const isDaylight = utcHours >= 1 && utcHours <= 12;
  
  // Sine curve centered around peak UTC solar noon (~6.5 UTC)
  const solarFactor = isDaylight 
    ? Math.max(0, Math.sin(((utcHours - 1) / 11) * Math.PI))
    : 0;

  const maxCapacityKw = 5.0;
  const baseVoltage = isDaylight ? 360 + (Math.random() * 8 - 4) : 0;

  // Realistic irradiance matching Open-Meteo satellite curve (~500 W/m² at 10:00 UTC / 3:30 PM IST)
  let simulatedIrradiance = Math.round(solarFactor * 950);
  let systemEfficiency = 0.82; // System PR baseline

  switch (scenario) {
    case "SOILING":
      systemEfficiency = 0.58;
      break;
    case "CLOUDY":
      systemEfficiency = 0.25;
      simulatedIrradiance = Math.round(simulatedIrradiance * 0.30);
      break;
    case "HARDWARE_FAULT":
      systemEfficiency = 0.20;
      break;
    case "OPTIMAL":
    default:
      systemEfficiency = 0.82;
      break;
  }

  // Calculate power tied directly to irradiance:
  // Power = Capacity * (Irradiance / 1000) * System Efficiency
  const currentPowerKw = parseFloat(
    Math.max(0, maxCapacityKw * (simulatedIrradiance / 1000) * systemEfficiency + (Math.random() * 0.02 - 0.01)).toFixed(3)
  );

  const currentAmperes = baseVoltage > 0
    ? parseFloat(((currentPowerKw * 1000) / baseVoltage).toFixed(2))
    : 0;

  const dailyKwhAccumulated = parseFloat((utcHours * 1.2 * solarFactor).toFixed(2));
  const inverterTempCelsius = parseFloat((28 + currentPowerKw * 3.8 + Math.random()).toFixed(1));

  return {
    currentPowerKw,
    voltageVolts: parseFloat(baseVoltage.toFixed(1)),
    currentAmperes,
    dailyKwhAccumulated,
    inverterTempCelsius,
    sensorIrradianceWm2: simulatedIrradiance,
  };
}
/**
 * Sends real-time telemetry to Next.js SolVigil API
 */
async function sendTelemetry() {
  const payload = generateSimulatedTelemetry(currentScenario);
  const endpoint = `${TARGET_API_URL}/api/v1/telemetry/stream`;

  console.log(`\n[${new Date().toLocaleTimeString()}] Sending Telemetry Stream...`);
  console.log(`Scenario: [${currentScenario}] | Power: ${payload.currentPowerKw} kW | Irradiance: ${payload.sensorIrradianceWm2} W/m²`);

  try {
    // Native global fetch in Node 18+
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Authorization/Server Error (${response.status}):`, data.error || data);
      return;
    }

    console.log(`✅ Transmission Successful!`);
    console.log(`   Installation ID: ${data.installationId}`);
    console.log(`   Diagnostic Category: [${data.diagnostic.faultCategory}]`);
    console.log(`   Expected Power: ${data.diagnostic.expectedPowerKw} kW | PR: ${(data.diagnostic.performanceRatio * 100).toFixed(1)}%`);
    console.log(`   Alert: "${data.diagnostic.alertMessage}"`);
  } catch (err: any) {
    console.error("❌ Connection failed:", err.message);
  }
}

// Execution Loop
console.log(`=======================================================`);
console.log(`  SolVigil IoT Smart Inverter Telemetry Simulator      `);
console.log(`  Targeting: ${TARGET_API_URL}/api/telemetry/stream     `);
console.log(`=======================================================`);

if (API_KEY === "YOUR_PLAIN_TEXT_API_KEY_HERE") {
  console.warn("\n⚠️ WARNING: Set process.env.SOLVIGIL_API_KEY or replace API_KEY with your installation's raw key!\n");
}

// Initial run & interval trigger
sendTelemetry();
setInterval(sendTelemetry, INTERVAL_SECONDS * 1000);