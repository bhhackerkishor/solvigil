import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { TelemetryLog } from "@/models/TelemetryLog";
import { verifyApiKey } from "@/lib/api-keys";
import { runDiagnostic } from "@/engine/orchestrator";

/**
 * POST /api/telemetry/stream — Legacy telemetry endpoint
 * Maps the incoming payload to the actual TelemetryLog schema structure.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Missing x-api-key header" }, { status: 401 });
    }

    await connectToDatabase();

    // Find installation by API key hash
    const installations = await SolarInstallation.find({ deletedAt: { $exists: false }, status: "active" });
    const installation = installations.find((inst) =>
      verifyApiKey(apiKey, inst.hardwareIntegration.apiKeyHash)
    );

    if (!installation) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const body = await request.json();
    const {
      currentPowerKw, voltageVolts, currentAmperes,
      dailyKwhAccumulated, inverterTempCelsius, sensorIrradianceWm2,
    } = body;

    if (currentPowerKw === undefined || voltageVolts === undefined || currentAmperes === undefined) {
      return NextResponse.json(
        { error: "currentPowerKw, voltageVolts, and currentAmperes are required" },
        { status: 400 }
      );
    }

    // Run diagnostic pipeline
    const diagnostic = await runDiagnostic({
      installation,
      currentPowerKw,
      voltageVolts,
      currentAmperes,
      dailyKwhAccumulated: dailyKwhAccumulated || 0,
      inverterTempCelsius: inverterTempCelsius || 25,
      sensorIrradianceWm2,
    });

    // Map to the actual TelemetryLog schema structure
    const cellTemp = (inverterTempCelsius || 25) + 15;

    await TelemetryLog.create({
      installationId: installation._id,
      timestamp: new Date(),
      telemetry: {
        powerKw: currentPowerKw,
        voltageVolts,
        currentAmperes,
        dailyKwhAccumulated: dailyKwhAccumulated || 0,
        inverterTempCelsius: inverterTempCelsius || 25,
        sensorIrradianceWm2,
      },
      environment: {
        ghi: 800,
        dni: 600,
        ambientTempCelsius: 25,
        windSpeedMps: 2.0,
        irradianceSource: sensorIrradianceWm2 ? "on-site-sensor" : "open-meteo",
      },
      physicsModel: {
        rawExpectedPowerKw: diagnostic.expectedPowerKw,
        expectedPowerEmaKw: diagnostic.expectedPowerKw,
        cellTemperatureCelsius: cellTemp,
        moduleTemperatureCelsius: cellTemp + 3,
        aoiDegrees: 5.2,
        transpositionFactor: 1.12,
        isClipping: false,
        clippingLossKw: 0,
      },
      derateFactors: {
        thermalDerate: 0.96,
        inverterEfficiency: installation.inverterSpecs.efficiency / 100,
        soilingDerate: 1.0,
        aoiLossFraction: 0.02,
        systemLossFraction: 0.14,
      },
      diagnostic: {
        performanceRatio: diagnostic.performanceRatio,
        lossKw: diagnostic.lossKw,
        estimatedDailyFinancialLossINR: diagnostic.estimatedDailyFinancialLossINR,
        faultCategory: diagnostic.faultCategory as any,
        faultConfidence: diagnostic.faultConfidence,
        alertMessage: diagnostic.alertMessage,
        alertColor: diagnostic.alertColor,
      },
      peerConsensus: {
        peerCount: diagnostic.peerGroup.peerCount,
        consensusPR: diagnostic.peerGroup.consensusPR,
      },
      engineVersion: "1.0.0",
    });

    // Update last telemetry timestamp
    SolarInstallation.updateOne(
      { _id: installation._id },
      { $set: { "hardwareIntegration.lastTelemetryAt": new Date() } }
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      installationId: installation._id,
      diagnostic: {
        expectedPowerKw: diagnostic.expectedPowerKw,
        performanceRatio: diagnostic.performanceRatio,
        faultCategory: diagnostic.faultCategory,
        faultConfidence: diagnostic.faultConfidence,
        lossKw: diagnostic.lossKw,
        estimatedDailyFinancialLossINR: diagnostic.estimatedDailyFinancialLossINR,
        alertMessage: diagnostic.alertMessage,
        alertColor: diagnostic.alertColor,
      },
    });
  } catch (error: any) {
    console.error("Telemetry stream error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
