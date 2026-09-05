import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { TelemetryLog } from "@/models/TelemetryLog";
import { AuditLog } from "@/models/AuditLog";
import { requireAuth } from "@/lib/rbac";
import { InstallationUpgradeSchema } from "@/lib/validation";
import { badRequest, notFound, withErrorHandling } from "@/lib/api-errors";
import { childLogger } from "@/lib/logger";

/**
 * PUT /api/v1/installations/[id]
 * Full update of installation — supports systemName, location, panelSpecs, inverterSpecs, hardware.
 */
export const PUT = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const log = childLogger({ route: "v1/installations/[id] PUT" });
  const ctx = await requireAuth(request, { minimumRole: "Owner" });
  if (ctx instanceof Response) return ctx;

  const body = await request.json();
  const parsed = InstallationUpgradeSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Validation failed", { issues: parsed.error.issues });
  }

  await connectToDatabase();
  const installation = await SolarInstallation.findOne({
    _id: id,
    organizationId: ctx.organizationId,
    deletedAt: { $exists: false },
  });

  if (!installation) return notFound("Installation not found");

  // Snapshot before state for audit
  const before = {
    systemName: installation.systemName,
    location: { ...installation.location },
    panelSpecs: { ...installation.panelSpecs },
    inverterSpecs: { ...installation.inverterSpecs },
    hardwareIntegration: {
      hasPhysicalIrradianceSensor: installation.hardwareIntegration.hasPhysicalIrradianceSensor,
      sensorDeviceId: installation.hardwareIntegration.sensorDeviceId,
    },
  };

  const data = parsed.data;

  // 1. System name
  if (data.systemName) {
    installation.systemName = data.systemName;
  }

  // 2. Full location update
  if (data.location) {
    installation.location.latitude = data.location.latitude;
    installation.location.longitude = data.location.longitude;
    installation.location.address = data.location.address;
    installation.location.city = data.location.city;
  }

  // 3. Full panel specs update
  if (data.panelSpecs) {
    Object.assign(installation.panelSpecs, data.panelSpecs);
  }

  // 4. Legacy delta-based update (backward compatible)
  if (data.panelCountDelta !== undefined && !data.panelSpecs) {
    installation.panelSpecs.panelCount += data.panelCountDelta;
    if (data.inverterSpecs) Object.assign(installation.inverterSpecs, data.inverterSpecs);
    const panelAreaPerWatt = 0.004;
    installation.panelSpecs.totalAreaSqMeters =
      installation.panelSpecs.panelCount * installation.panelSpecs.individualPanelWattage * panelAreaPerWatt;
    installation.panelSpecs.totalCapacityKw =
      (installation.panelSpecs.panelCount * installation.panelSpecs.individualPanelWattage) / 1000;
  }

  // 5. Inverter specs (partial)
  if (data.inverterSpecs) {
    Object.assign(installation.inverterSpecs, data.inverterSpecs);
  }

  // 6. Hardware integration (partial)
  if (data.hardwareIntegration) {
    Object.assign(installation.hardwareIntegration, data.hardwareIntegration);
  }

  await installation.save();

  await AuditLog.create({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: "UPDATE",
    resource: "SolarInstallation",
    resourceId: installation._id,
    changes: {
      before,
      after: {
        systemName: installation.systemName,
        location: { ...installation.location },
        panelSpecs: { ...installation.panelSpecs },
        inverterSpecs: { ...installation.inverterSpecs },
      },
    },
  });

  log.info({ installationId: id }, "Installation updated");

  return new Response(
    JSON.stringify({
      message: "Installation updated",
      installation: {
        id: installation._id,
        systemName: installation.systemName,
        location: installation.location,
        panelSpecs: installation.panelSpecs,
        inverterSpecs: installation.inverterSpecs,
        hardwareIntegration: {
          hasPhysicalIrradianceSensor: installation.hardwareIntegration.hasPhysicalIrradianceSensor,
          sensorDeviceId: installation.hardwareIntegration.sensorDeviceId,
          lastTelemetryAt: installation.hardwareIntegration.lastTelemetryAt,
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

/**
 * DELETE /api/v1/installations/[id]
 * Soft-deletes an installation. Historical telemetry remains queryable.
 */
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const log = childLogger({ route: "v1/installations/[id] DELETE" });
  const ctx = await requireAuth(request, { minimumRole: "Owner" });
  if (ctx instanceof Response) return ctx;

  await connectToDatabase();
  const installation = await SolarInstallation.findOneAndUpdate(
    { _id: id, organizationId: ctx.organizationId, deletedAt: { $exists: false } },
    { deletedAt: new Date(), status: "inactive" },
    { new: true }
  );

  if (!installation) return notFound("Installation not found");

  await AuditLog.create({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: "DELETE",
    resource: "SolarInstallation",
    resourceId: installation._id,
  });

  log.info({ installationId: id }, "Installation soft-deleted");

  return new Response(
    JSON.stringify({ message: "Installation deactivated" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

/**
 * GET /api/v1/installations/[id]
 * Returns a single installation with full details (for settings editing).
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const ctx = await requireAuth(request);
  if (ctx instanceof Response) return ctx;

  await connectToDatabase();
  const installation = await SolarInstallation.findOne({
    _id: id,
    organizationId: ctx.organizationId,
    deletedAt: { $exists: false },
  }).lean();

  if (!installation) return notFound("Installation not found");

  const inst = installation as any;
  return new Response(
    JSON.stringify({
      id: inst._id,
      systemName: inst.systemName,
      location: inst.location,
      panelSpecs: inst.panelSpecs,
      inverterSpecs: inst.inverterSpecs,
      hardwareIntegration: {
        hasPhysicalIrradianceSensor: inst.hardwareIntegration?.hasPhysicalIrradianceSensor ?? false,
        sensorDeviceId: inst.hardwareIntegration?.sensorDeviceId,
        hasApiKey: !!inst.hardwareIntegration?.apiKeyHash,
        lastTelemetryAt: inst.hardwareIntegration?.lastTelemetryAt,
      },
      installationDate: inst.installationDate,
      status: inst.status,
      createdAt: inst.createdAt,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
