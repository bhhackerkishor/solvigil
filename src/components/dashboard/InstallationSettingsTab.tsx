"use client";

import React, { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Save, MapPin, Loader2, CheckCircle2 } from "lucide-react";

interface Installation {
  id: string;
  systemName: string;
  location: {
    latitude: number;
    longitude: number;
    address: string;
    city: string;
  };
  panelSpecs: {
    totalCapacityKw: number;
    panelCount: number;
    individualPanelWattage: number;
    totalAreaSqMeters: number;
    panelEfficiencyPercentage: number;
    tiltAngle: number;
    azimuthAngle: number;
  };
  inverterSpecs: {
    brand: string;
    maxCapacityKw: number;
    efficiency: number;
  };
  hardwareIntegration: {
    hasPhysicalIrradianceSensor: boolean;
    sensorDeviceId?: string;
  };
}

interface InstallationSettingsTabProps {
  installation: Installation;
  onSaved?: () => void;
}

export default function InstallationSettingsTab({
  installation,
  onSaved,
}: InstallationSettingsTabProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [systemName, setSystemName] = useState(installation.systemName);
  const [latitude, setLatitude] = useState(String(installation.location.latitude));
  const [longitude, setLongitude] = useState(String(installation.location.longitude));
  const [address, setAddress] = useState(installation.location.address);
  const [city, setCity] = useState(installation.location.city);

  const [panelCount, setPanelCount] = useState(String(installation.panelSpecs.panelCount));
  const [panelWattage, setPanelWattage] = useState(String(installation.panelSpecs.individualPanelWattage));
  const [panelEfficiency, setPanelEfficiency] = useState(String(installation.panelSpecs.panelEfficiencyPercentage));
  const [tiltAngle, setTiltAngle] = useState(String(installation.panelSpecs.tiltAngle));
  const [azimuthAngle, setAzimuthAngle] = useState(String(installation.panelSpecs.azimuthAngle));

  const [inverterBrand, setInverterBrand] = useState(installation.inverterSpecs.brand);
  const [inverterMaxKw, setInverterMaxKw] = useState(String(installation.inverterSpecs.maxCapacityKw));
  const [inverterEfficiency, setInverterEfficiency] = useState(String(installation.inverterSpecs.efficiency));

  const [hasSensor, setHasSensor] = useState(installation.hardwareIntegration.hasPhysicalIrradianceSensor);
  const [sensorDeviceId, setSensorDeviceId] = useState(installation.hardwareIntegration.sensorDeviceId || "");

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);

    try {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const pc = parseInt(panelCount, 10);
      const pw = parseFloat(panelWattage);
      const pe = parseFloat(panelEfficiency);
      const tilt = parseFloat(tiltAngle);
      const az = parseFloat(azimuthAngle);
      const imk = parseFloat(inverterMaxKw);
      const ie = parseFloat(inverterEfficiency);

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new Error("Invalid latitude/longitude values");
      }

      const panelAreaPerWatt = 0.004;
      const totalArea = pc * pw * panelAreaPerWatt;
      const totalCapacityKw = (pc * pw) / 1000;

      const res = await fetch(`/api/v1/installations/${installation.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemName,
          location: {
            latitude: lat,
            longitude: lng,
            address,
            city,
          },
          panelSpecs: {
            panelCount: pc,
            individualPanelWattage: pw,
            panelEfficiencyPercentage: pe,
            tiltAngle: tilt,
            azimuthAngle: az,
            totalAreaSqMeters: totalArea,
            totalCapacityKw,
          },
          inverterSpecs: {
            brand: inverterBrand,
            maxCapacityKw: imk,
            efficiency: ie,
          },
          hardwareIntegration: {
            hasPhysicalIrradianceSensor: hasSensor,
            sensorDeviceId: sensorDeviceId || undefined,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to save");
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSaving(false);
    }
  }, [
    installation.id, systemName, latitude, longitude, address, city,
    panelCount, panelWattage, panelEfficiency, tiltAngle, azimuthAngle,
    inverterBrand, inverterMaxKw, inverterEfficiency,
    hasSensor, sensorDeviceId, onSaved,
  ]);

  return (
    <div className="space-y-6">
      {/* Location */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location
          </CardTitle>
          <CardDescription>
            Coordinates are used for satellite irradiance lookups and peer-group analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="latitude">Latitude</Label>
              <Input
                id="latitude"
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="e.g. 26.9124"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="longitude">Longitude</Label>
              <Input
                id="longitude"
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="e.g. 75.7873"
              />
            </div>
          </div>

          {/* Mini map placeholder */}
          <div className="relative h-48 rounded-lg border bg-muted/30 overflow-hidden flex items-center justify-center">
            <MapPlaceholder lat={parseFloat(latitude) || 0} lng={parseFloat(longitude) || 0} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Panel Specs */}
      <Card>
        <CardHeader>
          <CardTitle>Panel Specifications</CardTitle>
          <CardDescription>
            Changes to panel count will update capacity and area calculations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="panelCount">Panel Count</Label>
              <Input
                id="panelCount"
                type="number"
                value={panelCount}
                onChange={(e) => setPanelCount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="panelWattage">Wattage per Panel (W)</Label>
              <Input
                id="panelWattage"
                type="number"
                value={panelWattage}
                onChange={(e) => setPanelWattage(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="panelEfficiency">Efficiency (%)</Label>
              <Input
                id="panelEfficiency"
                type="number"
                value={panelEfficiency}
                onChange={(e) => setPanelEfficiency(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tiltAngle">Tilt Angle (°)</Label>
              <Input
                id="tiltAngle"
                type="number"
                value={tiltAngle}
                onChange={(e) => setTiltAngle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azimuthAngle">Azimuth Angle (°)</Label>
              <Input
                id="azimuthAngle"
                type="number"
                value={azimuthAngle}
                onChange={(e) => setAzimuthAngle(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inverter Specs */}
      <Card>
        <CardHeader>
          <CardTitle>Inverter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="inverterBrand">Brand</Label>
              <Input
                id="inverterBrand"
                value={inverterBrand}
                onChange={(e) => setInverterBrand(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inverterMaxKw">Max Capacity (kW)</Label>
              <Input
                id="inverterMaxKw"
                type="number"
                value={inverterMaxKw}
                onChange={(e) => setInverterMaxKw(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inverterEfficiency">Efficiency (%)</Label>
              <Input
                id="inverterEfficiency"
                type="number"
                value={inverterEfficiency}
                onChange={(e) => setInverterEfficiency(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sensor Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Hardware Sensor</CardTitle>
          <CardDescription>
            Physical irradiance sensors provide real-time ground-truth, overriding satellite data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="hasSensor"
              checked={hasSensor}
              onChange={(e) => setHasSensor(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="hasSensor" className="cursor-pointer">
              Physical irradiance sensor installed
            </Label>
          </div>
          {hasSensor && (
            <div className="space-y-2">
              <Label htmlFor="sensorDeviceId">Sensor Device ID</Label>
              <Input
                id="sensorDeviceId"
                value={sensorDeviceId}
                onChange={(e) => setSensorDeviceId(e.target.value)}
                placeholder="e.g. pyranometer-001"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Badge variant={hasSensor ? "default" : "secondary"}>
              {hasSensor ? "Sensor Mode" : "Satellite Mode"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {hasSensor
                ? "Telemetry sensor readings override satellite data"
                : "Using Open-Meteo satellite irradiance data"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3 justify-end">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {saved && (
          <p className="text-sm text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" /> Saved
          </p>
        )}
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

/** Simple map preview using Leaflet (client-only to avoid SSR issues) */
function MapPlaceholder({ lat, lng }: { lat: number; lng: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  React.useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Dynamic import to avoid SSR issues with Leaflet
    import("leaflet").then((L) => {
      if (!mapRef.current || mapInstanceRef.current) return;

      // Fix default marker icon paths
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current, {
        center: [lat || 26.9124, lng || 75.7873],
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);

      let marker = L.marker([lat || 26.9124, lng || 75.7873]).addTo(map);

      // Click to set new coordinates
      map.on("click", (e: L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        // Update the input fields
        const latInput = document.getElementById("latitude") as HTMLInputElement;
        const lngInput = document.getElementById("longitude") as HTMLInputElement;
        if (latInput) latInput.value = String(Math.round(e.latlng.lat * 10000) / 10000);
        if (lngInput) lngInput.value = String(Math.round(e.latlng.lng * 10000) / 10000);
        latInput.dispatchEvent(new Event("input", { bubbles: true }));
        lngInput.dispatchEvent(new Event("input", { bubbles: true }));
      });

      mapInstanceRef.current = map;

      // Fix Leaflet's container sizing
      setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [lat, lng]);

  return <div ref={mapRef} className="h-full w-full rounded-lg z-0" />;
}
