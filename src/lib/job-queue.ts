/**
 * Telemetry Processing Queue (BullMQ)
 *
 * Decouples telemetry ingestion from diagnostic computation.
 * Devices POST to /api/v1/telemetry/stream → job is enqueued →
 * worker runs physics engine asynchronously → writes result to DB.
 *
 * This prevents a burst of 10,000 devices from blocking API threads.
 */

import { Queue, Worker, Job } from "bullmq";
import { getRedisClient } from "./redis";

const QUEUE_NAME = "telemetry-processing";
const connection = getRedisClient();

// ── Job Types ─────────────────────────────────────────────────────────

export interface TelemetryJobData {
  installationId: string;
  organizationId: string;
  payload: {
    currentPowerKw: number;
    voltageVolts: number;
    currentAmperes: number;
    dailyKwhAccumulated: number;
    inverterTempCelsius: number;
    sensorIrradianceWm2?: number;
  };
  idempotencyKey: string;
}

// ── Queue (Enqueue side) ──────────────────────────────────────────────

export const telemetryQueue = new Queue<TelemetryJobData>(QUEUE_NAME, {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 3600 },  // keep results for 1 hour
    removeOnFail: { age: 86400 },     // keep failures for 24 hours
  },
});

/**
 * Enqueues a telemetry job for async processing.
 * Returns the job ID for tracking.
 */
export async function enqueueTelemetry(data: TelemetryJobData): Promise<string> {
  const job = await telemetryQueue.add("process", data, {
    jobId: data.idempotencyKey, // dedup via job ID
  });
  return job.id || "";
}

// ── Worker (Process side) ─────────────────────────────────────────────

export function createTelemetryWorker(
  processor: (data: TelemetryJobData) => Promise<void>
): Worker<TelemetryJobData> {
  return new Worker<TelemetryJobData>(
    QUEUE_NAME,
    async (job: Job<TelemetryJobData>) => {
      await processor(job.data);
    },
    {
      connection: connection as any,
      concurrency: 10,        // process 10 jobs in parallel
      limiter: {
        max: 100,
        duration: 1000,        // max 100 jobs per second
      },
    }
  );
}

// ── Queue Metrics ─────────────────────────────────────────────────────

export async function getQueueMetrics() {
  const [waiting, active, completed, failed] = await Promise.all([
    telemetryQueue.getWaitingCount(),
    telemetryQueue.getActiveCount(),
    telemetryQueue.getCompletedCount(),
    telemetryQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}
