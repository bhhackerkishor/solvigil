import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation, ISolarInstallation } from "@/models/SolarInstallation";
import { TelemetryLog } from "@/models/TelemetryLog";

const PEER_RADIUS_KM = 5;
const EARTH_RADIUS_KM = 6371;

/**
 * Calculates the Haversine distance between two lat/lng coordinates in km.
 */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Finds peer installations within PEER_RADIUS_KM km and returns their
 * most recent Performance Ratio values for consensus comparison.
 *
 * This is the spatial peer-group disambiguation mechanism:
 * if the target array is down but peers are healthy -> local fault
 * if all peers are down proportionally -> weather event
 */
export async function getPeerGroupPRs(
  targetInstallation: ISolarInstallation,
  excludeSelf: boolean = true
): Promise<{ peerPRs: number[]; peerCount: number; nearbyInstallations: string[] }> {
  await connectToDatabase();

  // Find installations within the radius using MongoDB aggregation
  const allInstallations = await SolarInstallation.find({
    _id: excludeSelf ? { $ne: targetInstallation._id } : targetInstallation._id,
  }).select("_id location.latitude longitude");

  const nearbyIds: string[] = [];
  for (const inst of allInstallations) {
    const distance = haversineDistance(
      targetInstallation.location.latitude,
      targetInstallation.location.longitude,
      inst.location.latitude,
      inst.location.longitude
    );
    if (distance <= PEER_RADIUS_KM) {
      nearbyIds.push(inst._id.toString());
    }
  }

  if (nearbyIds.length === 0) {
    return { peerPRs: [], peerCount: 0, nearbyInstallations: [] };
  }

  // Fetch the latest telemetry log for each peer to get their current PR
  const peerPRs: number[] = [];
  const peerNames: string[] = [];

  for (const peerId of nearbyIds) {
    const latestLog = await TelemetryLog.findOne({ installationId: peerId })
      .sort({ timestamp: -1 })
      .select("diagnostic.performanceRatio");

    if (latestLog) {
      peerPRs.push(latestLog.diagnostic.performanceRatio);
      peerNames.push(peerId);
    }
  }

  return {
    peerPRs,
    peerCount: peerPRs.length,
    nearbyInstallations: peerNames,
  };
}
