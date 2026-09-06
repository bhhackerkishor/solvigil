"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sun, MapPin, Cpu, Zap, ChevronRight, ChevronLeft, Loader2, Navigation, ExternalLink } from "lucide-react";

// Dynamically import the map component with SSR disabled
const LocationPickerMap = dynamic(() => import("./LocationPickerMap"), {
  ssr: false,
  loading: () => <div className="h-64 w-full bg-muted animate-pulse rounded-lg flex items-center justify-center text-sm text-muted-foreground">Loading Map...</div>,
});

const schemaStep1 = z.object({
  systemName: z.string().min(2, "System name must be at least 2 characters"),
  address: z.string().min(5, "Please enter a valid address"),
  city: z.string().min(2, "City is required"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  installationDate: z.string().min(1, "Installation date is required"),
});

const schemaStep2 = z.object({
  panelCount: z.number().int().min(1, "At least 1 panel required"),
  individualPanelWattage: z.number().min(50, "Minimum 50W per panel"),
  panelEfficiencyPercentage: z.number().min(5).max(50, "Efficiency must be 5-50%"),
  tiltAngle: z.number().min(0).max(90),
  azimuthAngle: z.number().min(0).max(360),
});

const schemaStep3 = z.object({
  inverterBrand: z.string().min(1, "Inverter brand is required"),
  inverterMaxCapacityKw: z.number().min(0.5, "Minimum 0.5 kW"),
  inverterEfficiency: z.number().min(50).max(100),
  hasPhysicalIrradianceSensor: z.boolean(),
  sensorDeviceId: z.string().optional(),
});

type Step1Data = z.infer<typeof schemaStep1>;
type Step2Data = z.infer<typeof schemaStep2>;
type Step3Data = z.infer<typeof schemaStep3>;

export default function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [isLocating, setIsLocating] = useState(false);

  const form1 = useForm<Step1Data>({
    resolver: zodResolver(schemaStep1),
    defaultValues: {
      systemName: "",
      address: "",
      city: "",
      latitude: 28.6139,
      longitude: 77.209,
      installationDate: new Date().toISOString().split("T")[0],
    },
  });

  const form2 = useForm<Step2Data>({
    resolver: zodResolver(schemaStep2),
    defaultValues: {
      panelCount: 10,
      individualPanelWattage: 500,
      panelEfficiencyPercentage: 20,
      tiltAngle: 20,
      azimuthAngle: 180,
    },
  });

  const form3 = useForm<Step3Data>({
    resolver: zodResolver(schemaStep3),
    defaultValues: {
      inverterBrand: "",
      inverterMaxCapacityKw: 5,
      inverterEfficiency: 96,
      hasPhysicalIrradianceSensor: false,
      sensorDeviceId: "",
    },
  });

  const currentLat = form1.watch("latitude");
  const currentLng = form1.watch("longitude");

  const handleGetCurrentLocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lng = parseFloat(position.coords.longitude.toFixed(6));
        form1.setValue("latitude", lat, { shouldValidate: true });
        form1.setValue("longitude", lng, { shouldValidate: true });
        setIsLocating(false);
      },
      (err) => {
        setError(`Unable to retrieve your location: ${err.message}`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleNext = async () => {
    if (step === 1) {
      const valid = await form1.trigger();
      if (!valid) return;
    } else if (step === 2) {
      const valid = await form2.trigger();
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, 3));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const onSubmit = async () => {
    const valid = await form3.trigger();
    if (!valid) return;

    setIsSubmitting(true);
    setError("");

    try {
      const s1 = form1.getValues();
      const s2 = form2.getValues();
      const s3 = form3.getValues();

      const totalCapacityKw = (s2.panelCount * s2.individualPanelWattage) / 1000;

      const res = await fetch("/api/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemName: s1.systemName,
          latitude: s1.latitude,
          longitude: s1.longitude,
          address: s1.address,
          city: s1.city,
          installationDate: s1.installationDate,
          totalCapacityKw,
          panelCount: s2.panelCount,
          individualPanelWattage: s2.individualPanelWattage,
          panelEfficiencyPercentage: s2.panelEfficiencyPercentage,
          tiltAngle: s2.tiltAngle,
          azimuthAngle: s2.azimuthAngle,
          inverterBrand: s3.inverterBrand,
          inverterMaxCapacityKw: s3.inverterMaxCapacityKw,
          inverterEfficiency: s3.inverterEfficiency,
          hasPhysicalIrradianceSensor: s3.hasPhysicalIrradianceSensor,
          sensorDeviceId: s3.sensorDeviceId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setApiKey(data.installation.apiKey);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to create installation");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <Sun className="h-8 w-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl">Installation Registered!</CardTitle>
          <CardDescription>Your solar array is now being monitored by SolVigil.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <Label className="text-xs uppercase text-muted-foreground">Your Telemetry API Key</Label>
            <p className="font-mono text-sm mt-1 break-all">{apiKey}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Use this key in the <code>x-api-key</code> header to stream live data from your inverter or ESP32 device.
            </p>
          </div>
          <Button onClick={() => (window.location.href = "/dashboard")} className="w-full">
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <Badge variant="secondary">Step {step} of 3</Badge>
        <div className="flex gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-2 w-12 rounded-full ${s <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> System Location
            </CardTitle>
            <CardDescription>Where is your solar installation located?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="systemName">System Name</Label>
              <Input id="systemName" placeholder="e.g. Rooftop Array - Main House" {...form1.register("systemName")} />
              {form1.formState.errors.systemName && (
                <p className="text-sm text-destructive">{form1.formState.errors.systemName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Interactive Location Picker</Label>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGetCurrentLocation}
                    disabled={isLocating}
                  >
                    {isLocating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Navigation className="h-3.5 w-3.5 mr-1" />
                    )}
                    Use Current Location
                  </Button>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${currentLat}&mlon=${currentLng}#map=16/${currentLat}/${currentLng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    OpenStreetMaps <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              <LocationPickerMap
                lat={currentLat || 28.6139}
                lng={currentLng || 77.209}
                onLocationSelect={(lat, lng) => {
                  form1.setValue("latitude", lat, { shouldValidate: true });
                  form1.setValue("longitude", lng, { shouldValidate: true });
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" placeholder="Full address" {...form1.register("address")} />
              {form1.formState.errors.address && (
                <p className="text-sm text-destructive">{form1.formState.errors.address.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" placeholder="e.g. New Delhi" {...form1.register("city")} />
              {form1.formState.errors.city && (
                <p className="text-sm text-destructive">{form1.formState.errors.city.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="latitude">Latitude</Label>
                <Input
                  id="latitude"
                  type="number"
                  step="any"
                  {...form1.register("latitude", { valueAsNumber: true })}
                />
                {form1.formState.errors.latitude && (
                  <p className="text-sm text-destructive">{form1.formState.errors.latitude.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="longitude">Longitude</Label>
                <Input
                  id="longitude"
                  type="number"
                  step="any"
                  {...form1.register("longitude", { valueAsNumber: true })}
                />
                {form1.formState.errors.longitude && (
                  <p className="text-sm text-destructive">{form1.formState.errors.longitude.message}</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="installationDate">Installation Date</Label>
              <Input id="installationDate" type="date" {...form1.register("installationDate")} />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="h-5 w-5" /> Panel Specifications
            </CardTitle>
            <CardDescription>Configure your solar panel array details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="panelCount">Panel Count</Label>
                <Input id="panelCount" type="number" {...form2.register("panelCount", { valueAsNumber: true })} />
                {form2.formState.errors.panelCount && (
                  <p className="text-sm text-destructive">{form2.formState.errors.panelCount.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="individualPanelWattage">Individual Panel Wattage (W)</Label>
                <Input
                  id="individualPanelWattage"
                  type="number"
                  {...form2.register("individualPanelWattage", { valueAsNumber: true })}
                />
                {form2.formState.errors.individualPanelWattage && (
                  <p className="text-sm text-destructive">{form2.formState.errors.individualPanelWattage.message}</p>
                )}
              </div>
            </div>
            <div className="p-3 bg-muted rounded-lg text-sm">
              Total Capacity: {(((form2.watch("panelCount") || 0) * (form2.watch("individualPanelWattage") || 0)) / 1000).toFixed(1)} kW
            </div>
            <div className="space-y-2">
              <Label htmlFor="panelEfficiencyPercentage">Panel Efficiency (%)</Label>
              <Input
                id="panelEfficiencyPercentage"
                type="number"
                step="0.1"
                {...form2.register("panelEfficiencyPercentage", { valueAsNumber: true })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tiltAngle">Tilt Angle (deg)</Label>
                <Input id="tiltAngle" type="number" step="1" {...form2.register("tiltAngle", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azimuthAngle">Azimuth Angle (deg, 180=South)</Label>
                <Input id="azimuthAngle" type="number" step="1" {...form2.register("azimuthAngle", { valueAsNumber: true })} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" /> Inverter & Hardware
            </CardTitle>
            <CardDescription>Configure inverter details and optional sensors.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inverterBrand">Inverter Brand</Label>
                <Input id="inverterBrand" placeholder="e.g. Growatt, SMA, Delta" {...form3.register("inverterBrand")} />
                {form3.formState.errors.inverterBrand && (
                  <p className="text-sm text-destructive">{form3.formState.errors.inverterBrand.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="inverterMaxCapacityKw">Inverter Max Capacity (kW)</Label>
                <Input
                  id="inverterMaxCapacityKw"
                  type="number"
                  step="0.1"
                  {...form3.register("inverterMaxCapacityKw", { valueAsNumber: true })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inverterEfficiency">Inverter Efficiency (%)</Label>
              <Input
                id="inverterEfficiency"
                type="number"
                step="0.1"
                {...form3.register("inverterEfficiency", { valueAsNumber: true })}
              />
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="space-y-1">
                <Label>Physical Irradiance Sensor</Label>
                <p className="text-sm text-muted-foreground">ESP32 LDR, Pyranometer, or Photodiode</p>
              </div>
              <Switch
                checked={form3.watch("hasPhysicalIrradianceSensor")}
                onCheckedChange={(val) => form3.setValue("hasPhysicalIrradianceSensor", val)}
              />
            </div>
            {form3.watch("hasPhysicalIrradianceSensor") && (
              <div className="space-y-2">
                <Label htmlFor="sensorDeviceId">Sensor Device ID (Optional)</Label>
                <Input id="sensorDeviceId" placeholder="e.g. ESP32-ROOF-001" {...form3.register("sensorDeviceId")} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={handleBack} disabled={step === 1}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        {step < 3 ? (
          <Button onClick={handleNext}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" /> Register Installation
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}