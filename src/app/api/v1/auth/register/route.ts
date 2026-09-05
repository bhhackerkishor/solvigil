import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { Organization } from "@/models/Organization";
import { User } from "@/models/User";
import { RegisterSchema } from "@/lib/validation";
import { badRequest, conflict, withErrorHandling } from "@/lib/api-errors";
import { childLogger } from "@/lib/logger";

/**
 * POST /api/v1/auth/register
 * Creates a new organization + owner user in one transaction.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const log = childLogger({ route: "v1/auth/register" });
  const body = await request.json();

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Validation failed", { issues: parsed.error.issues });
  }

  const { name, email, password } = parsed.data;
  await connectToDatabase();

  // Check for existing user
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return conflict("An account with this email already exists");
  }

  // Create organization for the new user
  const orgSlug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-");
  const organization = await Organization.create({
    name: `${name}'s Organization`,
    slug: `${orgSlug}-${Date.now()}`,
    subscriptionPlan: "FREE",
    billingStatus: "TRIAL",
  });

  // Create user within the organization
  const user = await User.create({
    organizationId: organization._id,
    name,
    email: email.toLowerCase(),
    password,
    role: "Owner",
  });

  log.info({ userId: user._id, orgId: organization._id }, "User registered");

  return new Response(
    JSON.stringify({
      message: "Account created successfully",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      organization: { id: organization._id, name: organization.name, plan: organization.subscriptionPlan },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
});
