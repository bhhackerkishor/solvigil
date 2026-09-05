import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { User } from "@/models/User";

/**
 * PUT /api/installations/[id]/upgrade — Legacy upgrade route
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const installation = await SolarInstallation.findOne({
      _id: id,
      organizationId: user.organizationId,
      deletedAt: { $exists: false },
    });
    if (!installation) return NextResponse.json({ error: "Installation not found" }, { status: 404 });

    const body = await request.json();
    const { panelCountDelta, individualPanelWattage, panelEfficiencyPercentage, inverterSpecs, hardwareIntegration } = body;

    if (panelCountDelta !== undefined) {
      installation.panelSpecs.panelCount += panelCountDelta;
      if (individualPanelWattage) installation.panelSpecs.individualPanelWattage = individualPanelWattage;
      if (panelEfficiencyPercentage) installation.panelSpecs.panelEfficiencyPercentage = panelEfficiencyPercentage;
      const panelAreaPerWatt = 0.004;
      installation.panelSpecs.totalAreaSqMeters =
        installation.panelSpecs.panelCount * installation.panelSpecs.individualPanelWattage * panelAreaPerWatt;
      installation.panelSpecs.totalCapacityKw =
        (installation.panelSpecs.panelCount * installation.panelSpecs.individualPanelWattage) / 1000;
    }

    if (inverterSpecs) {
      if (inverterSpecs.brand) installation.inverterSpecs.brand = inverterSpecs.brand;
      if (inverterSpecs.maxCapacityKw) installation.inverterSpecs.maxCapacityKw = inverterSpecs.maxCapacityKw;
      if (inverterSpecs.efficiency) installation.inverterSpecs.efficiency = inverterSpecs.efficiency;
    }

    if (hardwareIntegration) {
      if (hardwareIntegration.hasPhysicalIrradianceSensor !== undefined) {
        installation.hardwareIntegration.hasPhysicalIrradianceSensor = hardwareIntegration.hasPhysicalIrradianceSensor;
      }
      if (hardwareIntegration.sensorDeviceId !== undefined) {
        installation.hardwareIntegration.sensorDeviceId = hardwareIntegration.sensorDeviceId;
      }
    }

    await installation.save();
    return NextResponse.json({
      message: "Installation upgraded successfully",
      installation: {
        id: installation._id,
        panelSpecs: installation.panelSpecs,
        inverterSpecs: installation.inverterSpecs,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
