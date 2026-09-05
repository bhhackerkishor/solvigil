import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { Organization } from "@/models/Organization";
import { AuditLog } from "@/models/AuditLog";
import { requireAuth } from "@/lib/rbac";
import { InstallationCreateSchema } from "@/lib/validation";
import { generateApiKey } from "@/lib/api-keys";
import { badRequest, unauthorized, notFound, withErrorHandling } from "@/lib/api-errors";
import { encodeGeohash } from "@/engine/peer-group";
import { childLogger } from "@/lib/logger";

/**
 * POST /api/v1/installations
 * Creates a new solar installation within the user's organization.
 * Enforces plan limits on max installations.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const log = childLogger({ route: "v1/installations" });
  const ctx = await requireAuth(request, { minimumRole: "Owner" });
  if (ctx instanceof Response) return ctx;

  const body = await request.json();
  const parsed = InstallationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Validation failed", { issues: parsed.error.issues });
  }

  await connectToDatabase();

  // Check organization installation limit
  const org = await Organization.findById(ctx.organizationId);
  if (!org) return unauthorized("Organization not found");

  const currentCount = await SolarInstallation.countDocuments({
    organizationId: ctx.organizationId,
    deletedAt: { $exists: false },
  });

  if (currentCount >= org.limits.maxInstallations) {
    return badRequest(
      `Installation limit reached (${org.limits.maxInstallations} for ${org.subscriptionPlan} plan). Upgrade to add more.`
    );
  }

  const { systemName, location, panelSpecs, inverterSpecs, hardwareIntegration, installationDate } = parsed.data;

  // Generate API key (shown once, only hash stored)
  const { plaintext: apiKey, hash: apiKeyHash } = generateApiKey();

  // Compute geohash for peer-group bucketing
  const geohash = encodeGeohash(location.latitude, location.longitude);

  const installation = await SolarInstallation.create({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    systemName,
    location: { ...location, geohash },
    panelSpecs,
    inverterSpecs,
    hardwareIntegration: {
      apiKeyHash,
      hasPhysicalIrradianceSensor: hardwareIntegration?.hasPhysicalIrradianceSensor || false,
      sensorDeviceId: hardwareIntegration?.sensorDeviceId,
    },
    installationDate: new Date(installationDate),
  });

  // Audit log
  await AuditLog.create({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: "CREATE",
    resource: "SolarInstallation",
    resourceId: installation._id,
  });

  log.info({ installationId: installation._id, orgId: ctx.organizationId }, "Installation created");

  return new Response(
    JSON.stringify({
      message: "Installation created successfully",
      installation: {
        id: installation._id,
        systemName: installation.systemName,
        apiKey, // Plaintext — shown once, never returned again
        panelSpecs: installation.panelSpecs,
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
});

/**
 * GET /api/v1/installations
 * Lists all installations for the authenticated user's organization.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof Response) return ctx;

  await connectToDatabase();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const skip = (page - 1) * limit;

  const [installationsRaw, total] = await Promise.all([
    SolarInstallation.find({
      organizationId: ctx.organizationId,
      deletedAt: { $exists: false },
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SolarInstallation.countDocuments({
      organizationId: ctx.organizationId,
      deletedAt: { $exists: false },
    }),
  ]);

  // Strip apiKeyHash but add hasApiKey flag for UI
  const installations = installationsRaw.map((inst: any) => {
    const { hardwareIntegration, ...rest } = inst;
    const { apiKeyHash, ...safeHardware } = hardwareIntegration || {};
    return {
      ...rest,
      hardwareIntegration: {
        ...safeHardware,
        hasApiKey: !!apiKeyHash,
      },
    };
  });

  return new Response(
    JSON.stringify({
      installations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
