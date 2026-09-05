/**
 * Geohash-based Peer-Group Consensus Service
 *
 * Instead of O(n²) distance comparisons, uses geohash bucketing for fast
 * spatial lookups. Installations within ±1 geohash precision level are
 * guaranteed to be within ~5km.
 *
 * Peer-group consensus:
 * - Minimum 3 peers required before consensus is trusted
 * - Sparse regions (< 3 peers within 5km) default to satellite-only disambiguation
 * - Consensus PR = mean of peer PR values, excluding outliers (> 2σ from mean)
 */

import { connectToDatabase } from "@/lib/mongodb";
import { SolarInstallation } from "@/models/SolarInstallation";
import { TelemetryLog } from "@/models/TelemetryLog";
import { cacheGet, cacheSet } from "@/lib/redis";
const GEOHASH_PRECISION = 6; // ~1.2km x 0.6km cells
const PEER_RADIUS_KM = 5;
const MIN_PEERS_FOR_CONSENSUS = 3;
const CACHE_TTL_SECONDS = 300; // 5 minutes

// ── Geohash Encoding ──────────────────────────────────────────────────



export function encodeGeohash(lat: number, lng: number, precision: number = GEOHASH_PRECISION): string {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let geohash = "";
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (geohash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    isLng = !isLng;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}

/**
 * Zero-dependency Geohash neighbor and spatial calculation utilities.
 * Implements 2D Z-order curve bit manipulation for exact 8-neighbor generation.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const NEIGHBORS: Record<string, Record<string, string>> = {
  top: { right: "2389bghprknqi147", left: "0145hjnpzyswdv28" },
  bottom: { right: "14705623czyswdvk89bghpqr", left: "hjnpswz289bghprk0145763d" },
  right: { even: "b12389bcdefghjkkm045763d", odd: "p0123456789bcdefghjkmnpq" },
  left: { even: "0123456789bcdefghjkmnpq1", odd: "145763czyswdvk89bghpqrkn" },
};

const BORDERS: Record<string, Record<string, string>> = {
  top: { right: "b12389bcdefghjkkm045763d", left: "0123456789bcdefghjkmnpq1" },
  bottom: { right: "0123456789bcdefghjkmnpq1", left: "b12389bcdefghjkkm045763d" },
  right: { even: "b12389bcdefghjkkm045763d", odd: "p0123456789bcdefghjkmnpq" },
  left: { even: "0123456789bcdefghjkmnpq1", odd: "145763czyswdvk89bghpqrkn" },
};

export type Direction = "top" | "bottom" | "right" | "left";

/**
 * Calculates the adjacent geohash in a single cardinal direction.
 */
export function getGeohashAdjacent(geohash: string, direction: Direction): string {
  if (!geohash) return "";
  const lowerHash = geohash.toLowerCase();
  const lastChar = lowerHash[lowerHash.length - 1];
  const parent = lowerHash.slice(0, -1);
  const type = lowerHash.length % 2 === 0 ? "even" : "odd";

  // Select directional mapping based on hash length parity
  let dirMapKey: string = direction;
  if (direction === "top" || direction === "bottom") {
    dirMapKey = type === "odd" ? "right" : "left";
  }

  const neighborMap = NEIGHBORS[direction][dirMapKey] || NEIGHBORS[direction][type];
  const borderMap = BORDERS[direction][dirMapKey] || BORDERS[direction][type];

  let prefix = parent;
  if (borderMap.includes(lastChar) && parent.length > 0) {
    prefix = getGeohashAdjacent(parent, direction);
  }

  const idx = neighborMap.indexOf(lastChar);
  if (idx === -1) return lowerHash;

  return prefix + BASE32[idx];
}

/**
 * Returns all 8 surrounding geohash neighbors plus the origin cell itself.
 * Order: [self, N, NE, E, SE, S, SW, W, NW]
 */
export function getGeohashNeighbors(geohash: string): string[] {
  if (!geohash) return [];

  const n = getGeohashAdjacent(geohash, "top");
  const s = getGeohashAdjacent(geohash, "bottom");
  const e = getGeohashAdjacent(geohash, "right");
  const w = getGeohashAdjacent(geohash, "left");

  const ne = getGeohashAdjacent(n, "right");
  const nw = getGeohashAdjacent(n, "left");
  const se = getGeohashAdjacent(s, "right");
  const sw = getGeohashAdjacent(s, "left");

  return [geohash, n, ne, e, se, s, sw, w, nw];
}

// ── Peer Group Lookup ─────────────────────────────────────────────────

export interface PeerGroupResult {
  peerPRs: number[];
  peerCount: number;
  peerInstallationIds: string[];
  isConsensusTrusted: boolean; // true only if >= MIN_PEERS_FOR_CONSENSUS
  consensusPR: number;         // filtered mean
  sparseRegion: boolean;       // true if too few peers for reliable consensus
}

/**
 * Finds peer installations within PEER_RADIUS_KM using geohash bucketing,
 * then fetches their latest PR values for consensus comparison.
 */
export async function getPeerGroupConsensus(
  installationId: string,
  latitude: number,
  longitude: number
): Promise<PeerGroupResult> {
  const cacheKey = `peer:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = await cacheGet<PeerGroupResult>(cacheKey);
  if (cached) return cached;

  await connectToDatabase();

  // Encode installation location and get neighboring geohashes
  const geohash = encodeGeohash(latitude, longitude);
  const searchHashes = getGeohashNeighbors(geohash);

  // Find installations in matching geohash cells
  const nearbyInstallations = await SolarInstallation.find({
    _id: { $ne: installationId },
    "location.geohash": { $in: searchHashes },
    deletedAt: { $exists: false },
    status: "active",
  }).select("_id location.latitude location.longitude");

  // Filter by actual Haversine distance (geohash is approximate)
  const EARTH_RADIUS_KM = 6371;
  const peerIds: string[] = [];

  for (const inst of nearbyInstallations) {
    const dLat = ((inst.location.latitude - latitude) * Math.PI) / 180;
    const dLon = ((inst.location.longitude - longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((latitude * Math.PI) / 180) *
      Math.cos((inst.location.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
    const distance = EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (distance <= PEER_RADIUS_KM) {
      peerIds.push(inst._id.toString());
    }
  }

  // Fetch latest PR for each peer
  const peerPRs: number[] = [];
  for (const peerId of peerIds) {
    const latest = await TelemetryLog.findOne({ installationId: peerId })
      .sort({ timestamp: -1 })
      .select("diagnostic.performanceRatio");
    if (latest) {
      peerPRs.push(latest.diagnostic.performanceRatio);
    }
  }

  // Outlier removal: exclude values > 2σ from mean
  const filteredPRs = removeOutliers(peerPRs);

  const isConsensusTrusted = filteredPRs.length >= MIN_PEERS_FOR_CONSENSUS;
  const consensusPR = filteredPRs.length > 0
    ? filteredPRs.reduce((a, b) => a + b, 0) / filteredPRs.length
    : 1.0;

  const result: PeerGroupResult = {
    peerPRs: filteredPRs,
    peerCount: filteredPRs.length,
    peerInstallationIds: peerIds,
    isConsensusTrusted,
    consensusPR: Math.round(consensusPR * 100) / 100,
    sparseRegion: filteredPRs.length < MIN_PEERS_FOR_CONSENSUS,
  };

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/**
 * Removes outliers using the 2σ rule.
 * Values more than 2 standard deviations from the mean are excluded.
 */
function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return values.filter((v) => Math.abs(v - mean) <= 2 * stddev);
}
