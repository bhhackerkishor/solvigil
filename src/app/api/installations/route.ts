import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";
import { generateApiKey } from "@/lib/api-keys";
import { encodeGeohash } from "@/engine/peer-group";

// app/api/installations/route.ts

export async function POST(request: NextRequest) {
  try {
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    const body = await request.json();
    const {
      systemName, latitude, longitude, address, city,
      totalCapacityKw, panelCount, individualPanelWattage,
      panelEfficiencyPercentage, tiltAngle, azimuthAngle,
      inverterBrand, inverterMaxCapacityKw, inverterEfficiency,
      hasPhysicalIrradianceSensor, sensorDeviceId, installationDate,
    } = body;

    if (!systemName || !latitude || !longitude || !address || !city) {
      return NextResponse.json({ error: "System name and location are required" }, { status: 400 });
    }
    if (!panelCount || !individualPanelWattage || !panelEfficiencyPercentage) {
      return NextResponse.json({ error: "Panel specifications are required" }, { status: 400 });
    }

    const user = await User.findOne({ email: session.user.email });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // FIX: Fallback and create Organization if organizationId is missing on user
    let organizationId = user.organizationId;

    if (!organizationId) {
  const orgName = `${user.name || session.user.name || "Default"}'s Organization`;
  
  // Create a URL-safe slug (e.g., "john-doe-s-organization")
  const baseSlug = orgName
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
    
  // Append a short random string or timestamp to ensure slug uniqueness
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  let defaultOrg = await Organization.findOne({ slug });

  if (!defaultOrg) {
    defaultOrg = await Organization.create({
      name: orgName,
      slug,
    });
  }

  organizationId = defaultOrg._id;

  // Save the new organizationId to the user document
  user.organizationId = organizationId;
  await user.save();
}
    // Plan limit enforcement
    const org = await Organization.findById(organizationId);
    if (org) {
      const currentCount = await SolarInstallation.countDocuments({
        organizationId,
        deletedAt: { $exists: false },
      });
      if (currentCount >= org.limits.maxInstallations) {
        return NextResponse.json({
          error: `Array limit reached (${org.limits.maxInstallations} for ${org.subscriptionPlan} plan). Upgrade to add more installations.`,
        }, { status: 400 });
      }
    }

    const panelAreaPerWatt = 0.004;
    const totalAreaSqMeters = panelCount * individualPanelWattage * panelAreaPerWatt;
    const { plaintext: apiKey, hash: apiKeyHash } = generateApiKey();
    const geohash = encodeGeohash(latitude, longitude);

    const installation = await SolarInstallation.create({
      organizationId, // Guaranteed to be a valid ObjectId now
      userId: user._id,
      systemName,
      location: { latitude, longitude, address, city, geohash },
      panelSpecs: {
        totalCapacityKw: totalCapacityKw || (panelCount * individualPanelWattage) / 1000,
        panelCount,
        individualPanelWattage,
        totalAreaSqMeters,
        panelEfficiencyPercentage,
        tiltAngle: tiltAngle || 20,
        azimuthAngle: azimuthAngle || 180,
      },
      inverterSpecs: {
        brand: inverterBrand || "Default",
        maxCapacityKw: inverterMaxCapacityKw || totalCapacityKw || 5,
        efficiency: inverterEfficiency || 96,
      },
      hardwareIntegration: {
        apiKeyHash,
        hasPhysicalIrradianceSensor: hasPhysicalIrradianceSensor || false,
        sensorDeviceId: sensorDeviceId || undefined,
      },
      installationDate: installationDate ? new Date(installationDate) : new Date(),
    });

    return NextResponse.json({
      message: "Installation created successfully",
      installation: {
        id: installation._id,
        systemName: installation.systemName,
        apiKey,
        panelSpecs: installation.panelSpecs,
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("Installation creation error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/installations — Legacy list (uses new schema)
 */
export async function GET() {
  try {
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const installations = await SolarInstallation.find({
      organizationId: user.organizationId,
      deletedAt: { $exists: false },
    }).sort({ createdAt: -1 }).select("-hardwareIntegration.apiKeyHash");

    return NextResponse.json({ installations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
