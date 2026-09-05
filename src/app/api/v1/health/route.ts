import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import mongoose from "mongoose";

/**
 * GET /api/v1/health
 *
 * Health check endpoint verifying:
 * - MongoDB connectivity
 * - Open-Meteo API reachability
 * - Basic system info
 *
 * Does NOT require authentication (used by load balancers/monitoring).
 */
export async function GET(request: NextRequest) {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let overallStatus = "healthy";

  // 1. MongoDB check
  try {
    const start = Date.now();
    await connectToDatabase();
    await mongoose.connection.db?.admin().ping();
    checks.mongodb = { status: "healthy", latencyMs: Date.now() - start };
  } catch (err: any) {
    checks.mongodb = { status: "unhealthy", error: err.message };
    overallStatus = "degraded";
  }

  // 2. Open-Meteo API check
  try {
    const start = Date.now();
    const res = await fetch("https://api.open-meteo.com/v1/solar?latitude=28.61&longitude=77.21&current=ghi", {
      signal: AbortSignal.timeout(5000),
    });
    checks.openMeteo = {
      status: res.ok ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    checks.openMeteo = { status: "unreachable", error: err.message };
    overallStatus = "degraded";
  }

  const statusCode = overallStatus === "healthy" ? 200 : 503;

  return new Response(
    JSON.stringify({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      uptime: process.uptime(),
      checks,
    }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
