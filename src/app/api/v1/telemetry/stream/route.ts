import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { TelemetryLog } from "@/models/TelemetryLog";
import { TelemetryPayloadSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { isDuplicate, markProcessed } from "@/lib/idempotency";
import { runDiagnostic, ENGINE_VERSION } from "@/engine/orchestrator";
import { dispatchWebhook, shouldWebhook } from "@/lib/webhooks";
import {
  badRequest,
  unauthorized,
  tooManyRequests,
  withErrorHandling,
} from "@/lib/api-errors";
import { childLogger } from "@/lib/logger";
import { hashApiKey } from "@/lib/api-keys";
import { createHash } from "crypto";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const log = childLogger({ route: "v1/telemetry/stream" });

  // Step 1: Authenticate via API key header
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return badRequest("Missing x-api-key header");
  }

  // Step 2: Rate limiting (1 request per 30 seconds per API key)
  const rateLimitKey = `apikey:${apiKey.slice(0, 16)}`;
  const rateCheck = await checkRateLimit(rateLimitKey, {
    maxTokens: 2,
    refillRate: 1 / 30,
  });
  if (!rateCheck.allowed) {
    return tooManyRequests(
      `Rate limit exceeded. Retry after ${Math.ceil(
        rateCheck.retryAfterMs / 1000
      )}s`
    );
  }

  await connectToDatabase();

  // Step 3: Find installation by API key hash
  const apiKeyHash = hashApiKey(apiKey);
  const installation = await SolarInstallation.findOne({
    "hardwareIntegration.apiKeyHash": apiKeyHash,
    deletedAt: { $exists: false },
    status: "active",
  });

  if (!installation) {
    return unauthorized("Invalid API key");
  }

  // Step 4: Parse and validate incoming JSON payload
  const body = await request.json();
  
  const parsed = TelemetryPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid telemetry payload", {
      issues: parsed.error.issues,
    });
  }

  const {
    currentPowerKw,
    voltageVolts,
    currentAmperes,
    dailyKwhAccumulated,
    inverterTempCelsius,
    sensorIrradianceWm2,
  } = parsed.data;

  const timestamp = (body as any).timestamp || new Date();
  

  // Step 5: Idempotency check
  const idempotencyRaw = `${installation._id}:${currentPowerKw}:${voltageVolts}:${currentAmperes}:${dailyKwhAccumulated}`;
  const idempotencyKey = createHash("sha256")
    .update(idempotencyRaw)
    .digest("hex");

  if (await isDuplicate(idempotencyKey)) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "Duplicate telemetry — already processed",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch most recent telemetry record for EMA smoothing calculation
  const lastTelemetryDoc = await TelemetryLog.findOne({
    installationId: installation._id,
  })
    .sort({ timestamp: -1 })
    .select("physicsModel.expectedPowerEmaKw")
    .lean();

  // Step 6: Run diagnostic physics pipeline
  const diagnosticResult = await runDiagnostic({
    installation,
    currentPowerKw,
    voltageVolts,
    currentAmperes,
    dailyKwhAccumulated: dailyKwhAccumulated ?? 0,
    inverterTempCelsius,
    sensorIrradianceWm2: sensorIrradianceWm2 ?? 0,
    previousExpectedPowerKw: lastTelemetryDoc?.physicsModel?.expectedPowerEmaKw,
  });
  console.log("Diagnostic Keys:", Object.keys(diagnosticResult));
console.log("Diagnostic Payload:", JSON.stringify(diagnosticResult, null, 2));

  const telemetryTimestamp = timestamp ? new Date(timestamp) : new Date();
  const pvDetails = (diagnosticResult.pvModelDetails || {}) as any;
  // Step 7: Persist TelemetryLog

const telemetryLog = await TelemetryLog.create({
  installationId: installation._id,
  timestamp: telemetryTimestamp,

  // 1. Electrical Telemetry
  telemetry: {
    powerKw: currentPowerKw,
    voltageVolts: voltageVolts,
    currentAmperes: currentAmperes,
    dailyKwhAccumulated: dailyKwhAccumulated ?? 0,
    inverterTempCelsius: inverterTempCelsius,
    sensorIrradianceWm2: sensorIrradianceWm2,
  },

  // 2. Environmental / Weather Inputs
  environment: {
    ghi: diagnosticResult.satelliteData?.ghi ?? 0,
    dni: diagnosticResult.satelliteData?.dni ?? 0,
    ambientTempCelsius: diagnosticResult.satelliteData?.ambientTemp ?? 25,
    windSpeedMps: (diagnosticResult.satelliteData as any)?.windSpeed ?? 2.0,
    irradianceSource:
      (diagnosticResult.satelliteData?.source as any) || "satellite-fallback",
  },

  // 3. High-Precision Physics Calculations
  physicsModel: {
    rawExpectedPowerKw: diagnosticResult.expectedPowerKw ?? 0,
    expectedPowerEmaKw: diagnosticResult.expectedPowerEmaKw ?? 0,
    cellTemperatureCelsius: pvDetails.cellTemperature ?? 25,
    moduleTemperatureCelsius: pvDetails.moduleTemperature ?? 25,
    aoiDegrees: pvDetails.aoiDegrees ?? 0,
    transpositionFactor: pvDetails.transpositionFactor ?? 1,
    isClipping: pvDetails.isClipping ?? false,
    clippingLossKw: pvDetails.clippingLossKw ?? 0,
  },

  // 4. Itemized Derate Breakdown
  derateFactors: {
    thermalDerate: pvDetails.derateFactors?.thermal ?? 1,
    inverterEfficiency: pvDetails.derateFactors?.inverter ?? 0.96,
    soilingDerate: pvDetails.derateFactors?.soiling ?? 1,
    aoiLossFraction: pvDetails.aoiLossFraction ?? 0,
    systemLossFraction: 0.14,
  },

  // 5. Diagnostic Results
  diagnostic: {
    performanceRatio: diagnosticResult.performanceRatio ?? 0,
    lossKw: diagnosticResult.lossKw ?? 0,
    estimatedDailyFinancialLossINR:
      diagnosticResult.estimatedDailyFinancialLossINR ?? 0,
    faultCategory: (diagnosticResult.faultCategory || "OPTIMAL") as any,
    faultConfidence: diagnosticResult.faultConfidence ?? 1,
    alertMessage:
      diagnosticResult.alertMessage || "System performing nominally",
    alertColor: diagnosticResult.alertColor || "green",
  },

  // 6. Peer-Group Consensus Metadata
  peerConsensus: {
    peerCount: diagnosticResult.peerGroup?.peerCount ?? 0,
    consensusPR: diagnosticResult.peerGroup?.consensusPR ?? 0,
  },

  // 7. Engine Version
  engineVersion: ENGINE_VERSION,
});

  // Step 8: Mark payload as processed
  await markProcessed(idempotencyKey);

  // Step 9: Update last telemetry timestamp on installation
  await SolarInstallation.findByIdAndUpdate(installation._id, {
    "hardwareIntegration.lastTelemetryAt": telemetryTimestamp,
  });

  // Step 10: Dispatch webhook if alert condition is met
  if (shouldWebhook(diagnosticResult.faultCategory)) {
    dispatchWebhook(installation.organizationId.toString(), {
      event: `FAULT_${
        diagnosticResult.faultCategory === "HARDWARE_FAULT" ? "RED" : "YELLOW"
      }`,
      installationId: installation._id.toString(),
      systemName: installation.systemName,
      faultCategory: diagnosticResult.faultCategory,
      performanceRatio: diagnosticResult.performanceRatio,
      alertMessage: diagnosticResult.alertMessage,
      lossKw: diagnosticResult.lossKw,
      estimatedDailyFinancialLossINR:
        diagnosticResult.estimatedDailyFinancialLossINR,
      timestamp: telemetryTimestamp.toISOString(),
    }).catch((err) => log.error({ err }, "Webhook dispatch failed"));
  }

  log.info(
    {
      installationId: installation._id,
      pr: diagnosticResult.performanceRatio,
      fault: diagnosticResult.faultCategory,
      processingMs: diagnosticResult.processingTimeMs,
    },
    "Telemetry processed"
  );

  return new Response(
    JSON.stringify({
      success: true,
      logId: telemetryLog._id,
      installationId: installation._id,
      timestamp: telemetryTimestamp,
      telemetry: { currentPowerKw, voltageVolts, currentAmperes },
      diagnostic: {
        expectedPowerKw: diagnosticResult.expectedPowerKw,
        expectedPowerEmaKw: diagnosticResult.expectedPowerEmaKw,
        performanceRatio: diagnosticResult.performanceRatio,
        faultCategory: diagnosticResult.faultCategory,
        faultConfidence: diagnosticResult.faultConfidence,
        lossKw: diagnosticResult.lossKw,
        estimatedDailyFinancialLossINR:
          diagnosticResult.estimatedDailyFinancialLossINR,
        alertMessage: diagnosticResult.alertMessage,
        alertColor: diagnosticResult.alertColor,
      },
      peerGroup: {
        peerCount: diagnosticResult.peerGroup.peerCount,
        consensusPR: diagnosticResult.peerGroup.consensusPR,
        isConsensusTrusted: diagnosticResult.peerGroup.isConsensusTrusted,
      },
      processingTimeMs: diagnosticResult.processingTimeMs,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});