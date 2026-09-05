import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { requireAuth } from "@/lib/rbac";
import { withErrorHandling } from "@/lib/api-errors";
import { childLogger } from "@/lib/logger";

/**
 * GET /api/v1/simulator/my-arrays
 *
 * Returns active solar installations mapped to the tenant's context.
 * Used by the simulator console to populate the array selector dropdown.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const log = childLogger({ route: "v1/simulator/my-arrays" });

  const ctx = await requireAuth(request, { minimumRole: "Viewer" });
  if (ctx instanceof Response) return ctx;

  await connectToDatabase();

  const installations = await SolarInstallation.find({
    organizationId: ctx.organizationId,
    deletedAt: { $exists: false },
    status: "active",
  })
    // Updated selection string to include hardwareIntegration.apiKeyHash and lastTelemetryAt
    .select("systemName panelSpecs inverterSpecs hardwareIntegration location")
    .lean();

  const arrays = installations.map((inst) => ({
    id: inst._id.toString(),
    systemName: inst.systemName,
    hasApiKey: !!inst.hardwareIntegration?.apiKeyHash,
    lastTelemetryAt: inst.hardwareIntegration?.lastTelemetryAt || null,
    location: {
      latitude: inst.location?.latitude ?? 0,
      longitude: inst.location?.longitude ?? 0,
      city: inst.location?.city ?? "",
    },
    panelSpecs: {
      panelCount: inst.panelSpecs?.panelCount ?? 0,
      individualPanelWattage: inst.panelSpecs?.individualPanelWattage ?? 0,
      totalCapacityKw: inst.panelSpecs?.totalCapacityKw ?? 0,
      tiltAngle: inst.panelSpecs?.tiltAngle ?? 0,
      azimuthAngle: inst.panelSpecs?.azimuthAngle ?? 0,
      panelEfficiencyPercentage: inst.panelSpecs?.panelEfficiencyPercentage ?? 0,
    },
    inverterSpecs: {
      brand: inst.inverterSpecs?.brand ?? "",
      maxCapacityKw: inst.inverterSpecs?.maxCapacityKw ?? 0,
      efficiency: inst.inverterSpecs?.efficiency ?? 0,
    },
  }));

  log.info({ count: arrays.length }, "Fetched simulator arrays");

  return Response.json({ arrays }, { status: 200 });
});