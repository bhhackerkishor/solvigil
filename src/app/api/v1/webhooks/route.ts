import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { Organization } from "@/models/Organization";
import { requireAuth } from "@/lib/rbac";
import { WebhookRegisterSchema } from "@/lib/validation";
import { badRequest, notFound, withErrorHandling } from "@/lib/api-errors";
import { childLogger } from "@/lib/logger";
import crypto from "crypto";

/**
 * POST /api/v1/webhooks
 * Registers a webhook URL for fault alert notifications.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const log = childLogger({ route: "v1/webhooks" });
  const ctx = await requireAuth(request, { minimumRole: "Admin" });
  if (ctx instanceof Response) return ctx;

  const body = await request.json();
  const parsed = WebhookRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Validation failed", { issues: parsed.error.issues });
  }

  await connectToDatabase();
  const org = await Organization.findById(ctx.organizationId);
  if (!org) return notFound("Organization not found");

  const secret = parsed.data.secret || crypto.randomBytes(32).toString("hex");

  await Organization.findByIdAndUpdate(ctx.organizationId, {
    "settings.webhookUrl": parsed.data.url,
    "settings.webhookSecret": secret,
  });

  log.info({ orgId: ctx.organizationId, url: parsed.data.url }, "Webhook registered");

  return new Response(
    JSON.stringify({
      message: "Webhook registered successfully",
      webhook: {
        url: parsed.data.url,
        events: parsed.data.events,
        secret, // Show once — user must store it
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
});

/**
 * GET /api/v1/webhooks
 * Returns the current webhook configuration for the organization.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof Response) return ctx;

  await connectToDatabase();
  const org = await Organization.findById(ctx.organizationId).select("settings.webhookUrl settings.webhookSecret");

  return new Response(
    JSON.stringify({
      webhook: org?.settings?.webhookUrl
        ? { url: org.settings.webhookUrl, configured: true }
        : { configured: false },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
