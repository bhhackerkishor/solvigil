export interface SatelliteIrradianceData {
  ghi: number;
  dni: number;
  ambientTemp: number;
  timestamp: Date;
  source?: string;
}

/**
 * Fetches real-time solar irradiance and ambient weather from Open-Meteo Forecast API.
 * Uses global_tilted_irradiance_instant (or direct_normal_irradiance_instant) alongside 2m temperature.
 */
export async function fetchSatelliteIrradiance(
  latitude: number,
  longitude: number
): Promise<SatelliteIrradianceData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set(
    "current",
    "temperature_2m,direct_normal_irradiance_instant,global_tilted_irradiance_instant"
  );
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status}`);
  }

  const data = await response.json();
  const current = data.current;

  return {
    ghi: current?.global_tilted_irradiance_instant ?? 0,
    dni: current?.direct_normal_irradiance_instant ?? 0,
    ambientTemp: current?.temperature_2m ?? 25,
    timestamp: new Date(),
    source: "open-meteo",
  };
}

/**
 * Fetches forecasted solar irradiance for historical/expected comparison.
 * Uses hourly direct_normal_irradiance and global_tilted_irradiance.
 */
export async function fetchForecastIrradiance(
  latitude: number,
  longitude: number,
  date: string
): Promise<{ ghi: number; dni: number }[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set("hourly", "direct_normal_irradiance,global_tilted_irradiance");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url.toString());
  if (!response.ok) return [];

  const data = await response.json();
  const hourly = data.hourly;
  if (!hourly || !hourly.time) return [];

  return hourly.time.map((_: string, i: number) => ({
    ghi: hourly.global_tilted_irradiance?.[i] ?? 0,
    dni: hourly.direct_normal_irradiance?.[i] ?? 0,
  }));
}