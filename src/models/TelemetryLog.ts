import mongoose, { Schema, Document, Model } from "mongoose";

export interface ITelemetryLog extends Document {
  installationId: mongoose.Types.ObjectId;
  timestamp: Date;
  
  // Electrical Telemetry
  telemetry: {
    powerKw: number;
    voltageVolts: number;
    currentAmperes: number;
    dailyKwhAccumulated: number;
    inverterTempCelsius: number;
    sensorIrradianceWm2?: number;
  };

  // Environmental / Weather Inputs
  environment: {
    ghi: number;
    dni: number;
    ambientTempCelsius: number;
    windSpeedMps: number;
    irradianceSource: "on-site-sensor" | "open-meteo" | "satellite-fallback";
  };

  // High-Precision Physics Calculations (Sandia & Dynamic Inverter)
  physicsModel: {
    rawExpectedPowerKw: number;
    expectedPowerEmaKw: number; // Smoothed via Exponential Moving Average
    cellTemperatureCelsius: number; // Sandia Model
    moduleTemperatureCelsius: number; // Sandia Model
    aoiDegrees: number;
    transpositionFactor: number;
    isClipping: boolean;
    clippingLossKw: number;
  };

  // Itemized Derate Breakdown
  derateFactors: {
    thermalDerate: number;   // Sandia temperature adjustment
    inverterEfficiency: number; // Dynamic load-curve efficiency
    soilingDerate: number;   // Days-since-cleaned decay factor
    aoiLossFraction: number; // Angle of Incidence loss
    systemLossFraction: number; // Wiring/mismatch baseline losses
  };

  // Diagnostic Results
  diagnostic: {
    performanceRatio: number; // Actual vs EMA Expected
    lossKw: number;
    estimatedDailyFinancialLossINR: number;
    faultCategory:
      | "OPTIMAL"
      | "WEATHER_AFFECTED"
      | "SOILING_ALERT"
      | "HARDWARE_FAULT"
      | "SENSOR_CALIBRATION"
      |"UNKNOWN";
    faultConfidence: number;
    alertMessage: string;
    alertColor: "green" | "blue" | "yellow" | "red" | "gray";
  };

  // Peer-Group Consensus Metadata
  peerConsensus: {
    peerCount: number;
    consensusPR: number;
  };

  engineVersion: string;
}

const TelemetryLogSchema = new Schema<ITelemetryLog>(
  {
    installationId: {
      type: Schema.Types.ObjectId,
      ref: "SolarInstallation",
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },

    telemetry: {
      powerKw: { type: Number, required: true },
      voltageVolts: { type: Number, required: true },
      currentAmperes: { type: Number, required: true },
      dailyKwhAccumulated: { type: Number, default: 0 },
      inverterTempCelsius: { type: Number, required: true },
      sensorIrradianceWm2: { type: Number },
    },

    environment: {
      ghi: { type: Number, required: true },
      dni: { type: Number, required: true },
      ambientTempCelsius: { type: Number, required: true },
      windSpeedMps: { type: Number, default: 2.0 },
      irradianceSource: {
        type: String,
        enum: ["on-site-sensor", "open-meteo", "satellite-fallback"],
        required: true,
      },
    },

    physicsModel: {
      rawExpectedPowerKw: { type: Number, required: true },
      expectedPowerEmaKw: { type: Number, required: true },
      cellTemperatureCelsius: { type: Number, required: true },
      moduleTemperatureCelsius: { type: Number, required: true },
      aoiDegrees: { type: Number, required: true },
      transpositionFactor: { type: Number, required: true },
      isClipping: { type: Boolean, default: false },
      clippingLossKw: { type: Number, default: 0 },
    },

    derateFactors: {
      thermalDerate: { type: Number, required: true },
      inverterEfficiency: { type: Number, required: true },
      soilingDerate: { type: Number, required: true },
      aoiLossFraction: { type: Number, required: true },
      systemLossFraction: { type: Number, default: 0.14 },
    },

    diagnostic: {
      performanceRatio: { type: Number, required: true },
      lossKw: { type: Number, required: true },
      estimatedDailyFinancialLossINR: { type: Number, required: true },
      faultCategory: {
        type: String,
        enum: [
          "OPTIMAL",
          "WEATHER_AFFECTED",
          "SOILING_ALERT",
          "HARDWARE_FAULT",
          "SENSOR_CALIBRATION",
          "UNKNOWN",
        ],
        required: true,
      },
      faultConfidence: { type: Number, required: true },
      alertMessage: { type: String, required: true },
      alertColor: {
        type: String,
        enum: ["green", "blue", "yellow", "red", "gray"],
        required: true,
      },
    },

    peerConsensus: {
      peerCount: { type: Number, default: 0 },
      consensusPR: { type: Number, default: 0 },
    },

    engineVersion: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying time-series diagnostic data per plant
TelemetryLogSchema.index({ installationId: 1, timestamp: -1 });

export const TelemetryLog: Model<ITelemetryLog> =
  mongoose.models.TelemetryLog ||
  mongoose.model<ITelemetryLog>("TelemetryLog", TelemetryLogSchema);