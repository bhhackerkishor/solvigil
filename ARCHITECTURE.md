# SolVigil — Architecture Document

## System Overview

SolVigil is a multi-tenant SaaS that disambiguates solar performance losses —
distinguishing weather effects (cloud cover) from physical faults (soiling,
panel mismatch, bypass diode failure) without requiring expensive pyranometer
hardware.

## Data Flow

```
┌──────────────┐     POST /api/v1/telemetry/stream      ┌──────────────┐
│   IoT Device │ ───────────────────────────────────────►│  Next.js API │
│  (ESP32/Inv) │   Header: x-api-key: sv_...            │   Route v1   │
└──────────────┘                                         └──────┬───────┘
                                                                │
                                    ┌───────────────────────────┤
                                    │  1. Rate limit check      │
                                    │  2. API key verification  │
                                    │  3. Idempotency check     │
                                    │  4. Payload validation    │
                                    └───────────┬───────────────┘
                                                │
                                                ▼
                                   ┌────────────────────────┐
                                   │   Analysis Orchestrator │
                                   │  ┌──────────────────┐  │
                                   │  │  Open-Meteo API  │  │
                                   │  │  (satellite GHI)  │  │
                                   │  └────────┬─────────┘  │
                                   │           │             │
                                   │  ┌────────▼─────────┐  │
                                   │  │  PVWatts Model   │  │
                                   │  │  (expected power) │  │
                                   │  └────────┬─────────┘  │
                                   │           │             │
                                   │  ┌────────▼─────────┐  │
                                   │  │ Peer-Group       │  │
                                   │  │ (geohash lookup)  │  │
                                   │  └────────┬─────────┘  │
                                   │           │             │
                                   │  ┌────────▼─────────┐  │
                                   │  │  Classifier      │  │
                                   │  │  (decision tree)  │  │
                                   │  └────────┬─────────┘  │
                                   └───────────┼────────────┘
                                               │
                              ┌─────────────────┼─────────────────┐
                              ▼                 ▼                 ▼
                     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                     │   MongoDB    │  │    Redis     │  │   Webhook    │
                     │  Telemetry   │  │  Cache/Queue │  │  Dispatch    │
                     │    Logs      │  │              │  │              │
                     └──────┬───────┘  └──────────────┘  └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Dashboard  │
                     │  (React UI)  │
                     └──────────────┘
```

## Services

| Service | Technology | Purpose |
|---------|-----------|---------|
| Web App | Next.js 15 (App Router) | Auth, API routes, dashboard UI |
| Database | MongoDB 7 (Mongoose) | Persistent storage, time-series queries |
| Cache/Queue | Redis 7 | Rate limiting, idempotency, job queue, satellite cache |
| Satellite API | Open-Meteo | Real-time GHI/DNI irradiance data |
| Analysis Engine | TypeScript (PVWatts model + classifier) | Expected power calculation, fault disambiguation |

## Multi-Tenancy

Every document is scoped by `organizationId`. The RBAC hierarchy:
- **Viewer**: Read-only access (shared dashboards)
- **Owner**: Full CRUD on their installations
- **EPC_Vendor**: Can manage multiple customer arrays
- **Admin**: Organization settings, webhooks, team management

## Physics Engine

### PVWatts Model (simplified from NREL reference)
1. **Solar position**: Declination + hour angle from timestamp/location
2. **AOI**: Angle of incidence between sun and panel surface
3. **GTI**: Plane-of-array irradiance via isotropic diffuse model
4. **Temperature derating**: NOCT-based cell temperature estimation
5. **Inverter clipping**: DC power capped at inverter rated capacity
6. **System losses**: 14% baseline (wiring, mismatch, soiling)

### Disambiguation Classifier
Rule-based decision tree with confidence scoring:
- **OPTIMAL**: PR >= 0.85 with adequate irradiance
- **WEATHER_AFFECTED**: Low PR + low GHI + peers also degraded
- **SOILING_ALERT**: Clear sky + peers healthy + steady 5+ day degradation
- **HARDWARE_FAULT**: Clear sky + severe drop + same-hour pattern or sudden step

Confidence is adjusted by peer-group size (more peers = higher confidence).

## Data Retention

| Data Type | Retention | Strategy |
|-----------|-----------|----------|
| Raw telemetry | 90 days | MongoDB TTL index, auto-deleted |
| Hourly rollups | 1 year | Aggregated on read (no separate collection) |
| Daily aggregates | 2 years | Computed on-the-fly from raw data |
| Audit logs | Indefinite | Immutable, never deleted |

## Security

- API keys: SHA-256 hashed at rest, shown once at generation
- Auth: Auth.js v5 with JWT sessions + refresh rotation
- Rate limiting: 1 request per 30 seconds per API key (token bucket)
- Idempotency: Duplicate posts within same minute are deduplicated
- Webhook signatures: HMAC-SHA256 for payload verification

## API Versioning

All hardware-facing endpoints use `/api/v1/` prefix. The v1 contract is
frozen for deployed ESP32 firmware. Breaking changes go to `/api/v2/`.

## Local Development

```bash
docker-compose up -d          # Start Mongo + Redis
npm install                    # Install dependencies
npm run dev                    # Start dev server on :3000
node simulate-telemetry.js     # Simulate IoT device
```
