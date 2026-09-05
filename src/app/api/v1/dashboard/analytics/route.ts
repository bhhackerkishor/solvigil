import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongodb";
import { TelemetryLog } from "@/models/TelemetryLog";
import { SolarInstallation } from "@/models/SolarInstallation";
import { requireAuth } from "@/lib/rbac";
import { badRequest, notFound, withErrorHandling } from "@/lib/api-errors";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(request.url);
  const installationId = searchParams.get("installationId");
  const period = searchParams.get("period") || "7d";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") || "500"), 2000);

  if (!installationId) {
    return badRequest("installationId is required");
  }

  await connectToDatabase();

  const installation = await SolarInstallation.findOne({
    _id: installationId,
    organizationId: ctx.organizationId,
    deletedAt: { $exists: false },
  });

  if (!installation) return notFound("Installation not found");

  // Date range
  const now = new Date();
  const startDate = new Date(now);
  switch (period) {
    case "24h": startDate.setHours(startDate.getHours() - 24); break;
    case "7d": startDate.setDate(startDate.getDate() - 7); break;
    case "30d": startDate.setDate(startDate.getDate() - 30); break;
    case "90d": startDate.setDate(startDate.getDate() - 90); break;
    default: startDate.setDate(startDate.getDate() - 7);
  }

  const skip = (page - 1) * limit;

  // Support both String and ObjectId variants stored in DB
  const validObjectId = mongoose.Types.ObjectId.isValid(installationId)
    ? new mongoose.Types.ObjectId(installationId)
    : installationId;

  const dateQuery = {
    installationId: { $in: [installationId, validObjectId] },
    timestamp: { $gte: startDate },
  };

  const [logs, totalCount] = await Promise.all([
    TelemetryLog.find(dateQuery)
      .sort({ timestamp: 1 })
      .skip(skip)
      .limit(limit)
      .select("timestamp telemetry diagnostic physicsModel environment metrics diagnosticResult satelliteDataRef")
      .lean(),
    TelemetryLog.countDocuments(dateQuery),
  ]);

  // Helper function to extract field values across schema versions
  const getLogValues = (log: any) => {
    const power = log.telemetry?.powerKw ?? log.metrics?.currentPowerKw ?? 0;
    const pr = log.diagnostic?.performanceRatio ?? log.diagnosticResult?.performanceRatio ?? 0;
    const lossKw = log.diagnostic?.lossKw ?? log.diagnosticResult?.lossKw ?? 0;
    const rawExpectedKw = log.physicsModel?.expectedPowerEmaKw ?? log.diagnosticResult?.expectedPowerKw ?? (power + lossKw);
    const financialLoss = log.diagnostic?.estimatedDailyFinancialLossINR ?? log.diagnosticResult?.estimatedDailyFinancialLossINR ?? 0;
    const faultCat = log.diagnostic?.faultCategory ?? log.diagnosticResult?.faultCategory ?? "UNKNOWN";
    const faultConf = log.diagnostic?.faultConfidence ?? log.diagnosticResult?.faultConfidence ?? 0;
    const ghiVal = log.environment?.ghi ?? log.satelliteDataRef?.ghi ?? 0;

    return {
      power,
      pr,
      lossKw,
      expectedKw: rawExpectedKw,
      financialLoss,
      faultCategory: faultCat,
      faultConfidence: faultConf,
      ghi: ghiVal,
    };
  };

  // Daily aggregation
  const dailyMap = new Map<string, {
    prs: number[]; powers: number[]; expectedPowers: number[];
    losses: number[]; financialLosses: number[];
  }>();

  for (const log of logs) {
    const day = new Date(log.timestamp).toISOString().split("T")[0];
    if (!dailyMap.has(day)) {
      dailyMap.set(day, { prs: [], powers: [], expectedPowers: [], losses: [], financialLosses: [] });
    }
    const d = dailyMap.get(day)!;
    const v = getLogValues(log);

    d.prs.push(v.pr);
    d.powers.push(v.power);
    d.expectedPowers.push(v.expectedKw);
    d.losses.push(v.lossKw);
    d.financialLosses.push(v.financialLoss);
  }

  const dailyAggregates = Array.from(dailyMap.entries()).map(([date, data]) => ({
    date,
    averagePR: Math.round((data.prs.reduce((a, b) => a + b, 0) / (data.prs.length || 1)) * 100) / 100,
    averagePower: Math.round((data.powers.reduce((a, b) => a + b, 0) / (data.powers.length || 1)) * 1000) / 1000,
    averageExpected: Math.round((data.expectedPowers.reduce((a, b) => a + b, 0) / (data.expectedPowers.length || 1)) * 1000) / 1000,
    totalLossKw: Math.round(data.losses.reduce((a, b) => a + b, 0) * 1000) / 1000,
    totalFinancialLossINR: Math.round(data.financialLosses.reduce((a, b) => a + b, 0)),
    sampleCount: data.prs.length,
  }));

  const parsedLogs = logs.map(getLogValues);
  const latestLogValues = parsedLogs[parsedLogs.length - 1];

  const summary = {
    totalLogs: totalCount,
    averagePR: parsedLogs.length > 0
      ? Math.round((parsedLogs.reduce((a, b) => a + b.pr, 0) / parsedLogs.length) * 100) / 100
      : 0,
    averagePower: parsedLogs.length > 0
      ? Math.round((parsedLogs.reduce((a, b) => a + b.power, 0) / parsedLogs.length) * 1000) / 1000
      : 0,
    totalFinancialLossINR: Math.round(parsedLogs.reduce((a, b) => a + b.lossKw, 0) * 8 * 6.5),
    currentFaultCategory: latestLogValues?.faultCategory || "UNKNOWN",
  };

  const timeSeriesData = logs.map((log) => {
    const v = getLogValues(log);
    return {
      timestamp: log.timestamp,
      actualPower: v.power,
      expectedPower: v.expectedKw,
      performanceRatio: v.pr,
      ghi: v.ghi,
      faultCategory: v.faultCategory,
      faultConfidence: v.faultConfidence,
    };
  });

  return new Response(
    JSON.stringify({
      installation: {
        id: installation._id.toString(),
        systemName: installation.systemName,
        panelSpecs: installation.panelSpecs,
      },
      summary,
      dailyAggregates,
      timeSeriesData,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});