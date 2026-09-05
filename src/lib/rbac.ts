import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";
import { forbidden, unauthorized } from "@/lib/api-errors";

export type Role = "Owner" | "EPC_Vendor" | "Admin" | "Viewer";

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  organizationId: string;
}

interface RBACOptions {
  /** Minimum role level required. Hierarchy: Viewer < Owner < EPC_Vendor < Admin */
  minimumRole?: Role;
  /** Require organization membership */
  requireOrganization?: boolean;
}

const ROLE_HIERARCHY: Record<Role, number> = {
  Viewer: 0,
  Owner: 1,
  EPC_Vendor: 2,
  Admin: 3,
};

/**
 * Authenticates the request and returns the auth context with RBAC enforcement.
 *
 * Usage in route handlers:
 *   const ctx = await requireAuth(request, { minimumRole: "Owner" });
 *   if (ctx instanceof NextResponse) return ctx; // error response
 */
export async function requireAuth(
  request: NextRequest,
  options: RBACOptions = {}
): Promise<AuthContext | ReturnType<typeof forbidden>> {
  const session = await auth();
  if (!session?.user) {
    return unauthorized();
  }

  await connectToDatabase();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return unauthorized();

  const userRole = (user.role || "Owner") as Role;

  // Check role hierarchy
  if (options.minimumRole) {
    const required = ROLE_HIERARCHY[options.minimumRole];
    const actual = ROLE_HIERARCHY[userRole] ?? 0;
    if (actual < required) {
      return forbidden(`Requires ${options.minimumRole} role or higher`);
    }
  }

  return {
    userId: user._id.toString(),
    email: user.email,
    role: userRole,
    organizationId: user.organizationId?.toString() || "",
  };
}

/**
 * Verifies the user has access to a specific organization's resources.
 * Returns forbidden() if not a member, or the membership record.
 */
export async function requireOrganizationAccess(
  userId: string,
  organizationId: string
): Promise<boolean | ReturnType<typeof forbidden>> {
  const user = await User.findOne({ _id: userId, organizationId });
  if (!user) return forbidden("Not a member of this organization");
  return true;
}

/**
 * Checks if a role can perform a specific action.
 */
export function canPerformAction(role: Role, action: "read" | "write" | "admin"): boolean {
  const level = ROLE_HIERARCHY[role] ?? 0;
  switch (action) {
    case "read": return level >= ROLE_HIERARCHY.Viewer;
    case "write": return level >= ROLE_HIERARCHY.Owner;
    case "admin": return level >= ROLE_HIERARCHY.Admin;
    default: return false;
  }
}
