import mongoose, { Schema, Document, Model } from "mongoose";

export type SubscriptionPlan = "FREE" | "PRO" | "ENTERPRISE";
export type BillingStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIAL";

export interface IOrganization extends Document {
  name: string;
  slug: string;
  subscriptionPlan: SubscriptionPlan;
  billingStatus: BillingStatus;
  billingStripeId?: string;
  limits: {
    maxInstallations: number;
    maxTelemetryRetentionDays: number;
    maxSeats: number;
  };
  settings: {
    defaultCurrency: string;
    timezone: string;
    webhookUrl?: string;
    webhookSecret?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const PLAN_LIMITS: Record<SubscriptionPlan, IOrganization["limits"]> = {
  FREE: { maxInstallations: 3, maxTelemetryRetentionDays: 30, maxSeats: 1 },
  PRO: { maxInstallations: 50, maxTelemetryRetentionDays: 365, maxSeats: 10 },
  ENTERPRISE: { maxInstallations: 10000, maxTelemetryRetentionDays: 730, maxSeats: 100 },
};

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    subscriptionPlan: {
      type: String,
      enum: ["FREE", "PRO", "ENTERPRISE"],
      default: "FREE",
    },
    billingStatus: {
      type: String,
      enum: ["ACTIVE", "PAST_DUE", "CANCELED", "TRIAL"],
      default: "TRIAL",
    },
    billingStripeId: { type: String },
    limits: {
      maxInstallations: { type: Number, default: PLAN_LIMITS.FREE.maxInstallations },
      maxTelemetryRetentionDays: { type: Number, default: PLAN_LIMITS.FREE.maxTelemetryRetentionDays },
      maxSeats: { type: Number, default: PLAN_LIMITS.FREE.maxSeats },
    },
    settings: {
      defaultCurrency: { type: String, default: "INR" },
      timezone: { type: String, default: "Asia/Kolkata" },
      webhookUrl: { type: String },
      webhookSecret: { type: String },
    },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

OrganizationSchema.index({ slug: 1 });
OrganizationSchema.index({ deletedAt: 1 });

OrganizationSchema.pre("save", function () {
  if (this.isModified("subscriptionPlan")) {
    const planLimits = PLAN_LIMITS[this.subscriptionPlan];
    this.limits = { ...planLimits };
  }
});

export const Organization: Model<IOrganization> =
  mongoose.models.Organization ||
  mongoose.model<IOrganization>("Organization", OrganizationSchema);
