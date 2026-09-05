import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { AuditLog } from "@/models/AuditLog";
import { requireAuth } from "@/lib/rbac";
import { notFound, withErrorHandling } from "@/lib/api-errors";
import { childLogger } from "@/lib/logger";

/**
 * PATCH /api/v1/installations/[id]/regenerate-api-key
 *
 * Invalidates the previous API key and issues a new one.
 * Protected by RBAC — minimum role: Owner.
 * The raw plaintext is returned exactly once; only the SHA-256 hash is stored.
 */
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const log = childLogger({ route: "v1/installations/[id]/regenerate-api-key" });

  const ctx = await requireAuth(request, { minimumRole: "Owner" });
  if (ctx instanceof Response) return ctx;

  await connectToDatabase();

  const installation = await SolarInstallation.findOne({
    _id: id,
    organizationId: ctx.organizationId,
    deletedAt: { $exists: false },
  });

  if (!installation) return notFound("Installation not found");

  const previousHash = installation.hardwareIntegration.apiKeyHash;

  const plaintext = installation.regenerateApiKey();
  await installation.save();

  await AuditLog.create({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: "REGENERATE_API_KEY",
    resource: "SolarInstallation",
    resourceId: installation._id,
    changes: {
      apiKeyHash: {
        before: previousHash,
        after: installation.hardwareIntegration.apiKeyHash,
      },
    },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  log.info({ installationId: id }, "API key regenerated");

  return new Response(
    JSON.stringify({
      message: "API key regenerated successfully. Copy this token immediately — it will never be displayed again.",
      apiKey: plaintext,
      installationId: installation._id,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
