import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";

/**
 * POST /api/auth/register
 * Creates a new user account with hashed password and initial Organization.
 */
export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // 1. Generate organization name and unique slug
    const orgName = `${name}'s Organization`;
    const baseSlug = orgName
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // 2. Create the default organization
    const organization = await Organization.create({
      name: orgName,
      slug,
    });

    // 3. Create the user with the generated organizationId
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: "Owner",
      organizationId: organization._id,
    });

    return NextResponse.json(
      { message: "Account created successfully", userId: user._id },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}