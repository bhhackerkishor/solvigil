/**
 * Webhook dispatch service.
 *
 * Sends fault alerts (YELLOW/RED status) to user-registered webhook URLs.
 * Implements retry with exponential backoff and signature verification.
 */

import crypto from "crypto";
import { connectToDatabase } from "@/lib/mongodb";
import { Organization } from "@/models/Organization";
import { logger } from "./logger";

interface WebhookPayload {
  event: string;
  installationId: string;
  systemName: string;
  faultCategory: string;
  performanceRatio: number;
  alertMessage: string;
  lossKw: number;
  estimatedDailyFinancialLossINR: number;
  timestamp: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 5000, 15000];

/**
 * Dispatches a webhook to all registered URLs for the given organization.
 * Only sends for actionable events (FAULT_YELLOW, FAULT_RED).
 */
export async function dispatchWebhook(
  organizationId: string,
  payload: WebhookPayload
): Promise<void> {
  await connectToDatabase();
  const org = await Organization.findById(organizationId);
  if (!org?.settings?.webhookUrl) return;

  const body = JSON.stringify(payload);
  const secret = org.settings.webhookSecret || "";

  // HMAC-SHA256 signature for verification
  const signature = secret
    ? crypto.createHmac("sha256", secret).update(body).digest("hex")
    : "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-SolVigil-Event": payload.event,
    "X-SolVigil-Signature": signature,
    "X-SolVigil-Timestamp": new Date().toISOString(),
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(org.settings.webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        logger.info({
          event: "webhook_delivered",
          organizationId,
          status: res.status,
          attempt: attempt + 1,
        });
        return;
      }

      // Don't retry on 4xx (except 429)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        logger.warn({
          event: "webhook_rejected",
          organizationId,
          status: res.status,
        });
        return;
      }
    } catch (err: any) {
      logger.error({
        event: "webhook_delivery_failed",
        organizationId,
        attempt: attempt + 1,
        error: err.message,
      });
    }

    // Wait before retry
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  logger.error({ event: "webhook_all_retries_failed", organizationId });
}

/**
 * Determines if a fault category should trigger a webhook.
 */
export function shouldWebhook(faultCategory: string): boolean {
  return ["SOILING_ALERT", "HARDWARE_FAULT"].includes(faultCategory);
}
