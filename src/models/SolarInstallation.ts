import mongoose, { Schema, Document, Model } from "mongoose";
import { generateApiKey, sha256 } from "@/lib/api-keys";

export interface ISolarInstallation extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  systemName: string;
  location: {
    latitude: number;
    longitude: number;
    address: string;
    city: string;
    geohash?: string;
  };
  panelSpecs: {
    totalCapacityKw: number;
    panelCount: number;
    individualPanelWattage: number;
    totalAreaSqMeters: number;
    panelEfficiencyPercentage: number;
    tiltAngle: number;
    azimuthAngle: number;
    noct?: number; // Nominal Operating Cell Temperature for derating
  };
  inverterSpecs: {
    brand: string;
    maxCapacityKw: number;
    efficiency: number;
  };
  hardwareIntegration: {
    apiKeyHash: string; // SHA-256 hash — never store raw key
    hasPhysicalIrradianceSensor: boolean;
    sensorDeviceId?: string;
    lastTelemetryAt?: Date;
  };
  installationDate: Date;
  status: "active" | "inactive" | "maintenance";
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;

  // Instance methods
  generateNewApiKey(): string;
  regenerateApiKey(): string;
  verifyApiKey(plaintext: string): boolean;
}

const SolarInstallationSchema = new Schema<ISolarInstallation>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: false, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    systemName: { type: String, required: true, trim: true },
    location: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      geohash: { type: String },
    },
    panelSpecs: {
      totalCapacityKw: { type: Number, required: true },
      panelCount: { type: Number, required: true },
      individualPanelWattage: { type: Number, required: true },
      totalAreaSqMeters: { type: Number, required: true },
      panelEfficiencyPercentage: { type: Number, required: true },
      tiltAngle: { type: Number, required: true },
      azimuthAngle: { type: Number, required: true },
      noct: { type: Number, default: 45 }, // Standard NOCT ~45°C
    },
    inverterSpecs: {
      brand: { type: String, required: true },
      maxCapacityKw: { type: Number, required: true },
      efficiency: { type: Number, required: true },
    },
    hardwareIntegration: {
      apiKeyHash: { type: String, required: true, unique: true ,sparse: true },
      hasPhysicalIrradianceSensor: { type: Boolean, default: false },
      sensorDeviceId: { type: String },
      lastTelemetryAt: { type: Date },
    },
    installationDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "inactive", "maintenance"],
      default: "active",
    },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

/**
 * Generate a new API key and store only its SHA-256 hash.
 * Returns the plaintext key (shown once to user).
 */
SolarInstallationSchema.methods.generateNewApiKey = function (): string {
  const { plaintext, hash } = generateApiKey();
  this.hardwareIntegration.apiKeyHash = hash;
  return plaintext;
};

/**
 * Regenerates the API key, invalidating the previous one permanently.
 * Stores only the SHA-256 hash. Returns the raw plaintext exactly once.
 */
SolarInstallationSchema.methods.regenerateApiKey = function (): string {
  const { plaintext, hash } = generateApiKey();
  this.hardwareIntegration.apiKeyHash = hash;
  this.updatedAt = new Date();
  return plaintext;
};

/**
 * Verifies a plaintext API key against the stored hash using constant-time comparison.
 */
SolarInstallationSchema.methods.verifyApiKey = function (plaintext: string): boolean {
  return require("@/lib/api-keys").verifyApiKey(
    plaintext,
    this.hardwareIntegration.apiKeyHash
  );
};

SolarInstallationSchema.index({ organizationId: 1, userId: 1 });
SolarInstallationSchema.index({ "location.latitude": 1, "location.longitude": 1 });
SolarInstallationSchema.index({ deletedAt: 1 });

export const SolarInstallation: Model<ISolarInstallation> =
  mongoose.models.SolarInstallation ||
  mongoose.model<ISolarInstallation>("SolarInstallation", SolarInstallationSchema);
