import { z } from "zod";

// ── Shared Zod schemas — single source of truth for client + server ───

export const OrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  subscriptionPlan: z.enum(["FREE", "PRO", "ENTERPRISE"]).default("FREE"),
  billingStatus: z.enum(["ACTIVE", "PAST_DUE", "CANCELED", "TRIAL"]).default("TRIAL"),
  settings: z
    .object({
      defaultCurrency: z.string().default("INR"),
      timezone: z.string().default("Asia/Kolkata"),
      webhookUrl: z.string().url().optional(),
    })
    .optional(),
});

export const UserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(128),
  role: z.enum(["Owner", "EPC_Vendor", "Admin", "Viewer"]).default("Owner"),
});

export const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(5).max(500),
  city: z.string().min(1).max(100),
});

export const PanelSpecsSchema = z.object({
  totalCapacityKw: z.number().positive(),
  panelCount: z.number().int().positive(),
  individualPanelWattage: z.number().positive(),
  totalAreaSqMeters: z.number().positive(),
  panelEfficiencyPercentage: z.number().min(5).max(50),
  tiltAngle: z.number().min(0).max(90),
  azimuthAngle: z.number().min(0).max(360),
});

export const InverterSpecsSchema = z.object({
  brand: z.string().min(1).max(100),
  maxCapacityKw: z.number().positive(),
  efficiency: z.number().min(50).max(100),
});

export const InstallationCreateSchema = z.object({
  systemName: z.string().min(2).max(200),
  location: LocationSchema,
  panelSpecs: PanelSpecsSchema,
  inverterSpecs: InverterSpecsSchema,
  hardwareIntegration: z
    .object({
      hasPhysicalIrradianceSensor: z.boolean().default(false),
      sensorDeviceId: z.string().max(100).optional(),
    })
    .optional(),
  installationDate: z.string().or(z.date()),
});

export const InstallationUpgradeSchema = z.object({
  systemName: z.string().min(2).max(200).optional(),
  location: LocationSchema.optional(),
  panelSpecs: z
    .object({
      panelCount: z.number().int().positive(),
      individualPanelWattage: z.number().positive(),
      panelEfficiencyPercentage: z.number().min(5).max(50),
      tiltAngle: z.number().min(0).max(90),
      azimuthAngle: z.number().min(0).max(360),
      totalAreaSqMeters: z.number().positive(),
      totalCapacityKw: z.number().positive(),
    })
    .optional(),
  panelCountDelta: z.number().int().optional(),
  inverterSpecs: InverterSpecsSchema.partial().optional(),
  hardwareIntegration: z
    .object({
      hasPhysicalIrradianceSensor: z.boolean().optional(),
      sensorDeviceId: z.string().max(100).optional(),
    })
    .optional(),
});

// Replace lines 69-77 with this:
// Add 'export' and change casing to PascalCase
export const TelemetryPayloadSchema = z.object({
  currentPowerKw: z.number().min(0),
  voltageVolts: z.number().min(0).default(0),
  currentAmperes: z.number().min(0).default(0),
  inverterTempCelsius: z.number().default(25),
  dailyKwhAccumulated: z.number().min(0).optional(),
  sensorIrradianceWm2: z.number().min(0).optional(),
});
export const RegisterSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

export const WebhookRegisterSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(["FAULT_YELLOW", "FAULT_RED", "PR_DEGRADED"])).min(1),
  secret: z.string().min(8).max(100).optional(),
});

// ── API error response schema ─────────────────────────────────────────
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.any()).optional(),
  }),
});
