"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Play,
  Loader2,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Sun,
  Thermometer,
  Gauge,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
} from "lucide-react";

interface ArrayConfig {
  id: string;
  systemName: string;
  hasApiKey: boolean;
  location: { latitude: number; longitude: number; city: string };
  panelSpecs: {
    panelCount: number;
    individualPanelWattage: number;
    totalCapacityKw: number;
    tiltAngle: number;
    azimuthAngle: number;
    panelEfficiencyPercentage: number;
  };
  inverterSpecs: {
    brand: string;
    maxCapacityKw: number;
    efficiency: number;
  };
}

interface TelemetryState {
  currentOutputKw: number;
  irradiance: number;
  efficiency: number;
  inverterTempC: number;
  voltage: number;
  current: number;
}

interface IngestionResult {
  timestamp: string;
  success: boolean;
  diagnostic?: {
    performanceRatio: number;
    faultCategory: string;
    faultConfidence: number;
    alertMessage: string;
    alertColor: string;
  };
  error?: string;
}

export default function SimulatorConsole() {
  const [arrays, setArrays] = useState<ArrayConfig[]>([]);
  const [selectedArrayId, setSelectedArrayId] = useState<string>("");
  const [isLoadingArrays, setIsLoadingArrays] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [results, setResults] = useState<IngestionResult[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // API key per array — stored in memory, never persisted
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeyInput, setShowKeyInput] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState(false);

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    currentOutputKw: 4.2,
    irradiance: 800,
    efficiency: 0.92,
    inverterTempC: 42,
    voltage: 380,
    current: 11.05,
  });

  const selectedArray = arrays.find((a) => a.id === selectedArrayId);
  const currentApiKey = apiKeys[selectedArrayId] || "";

  // Fetch available arrays
  useEffect(() => {
    async function fetchArrays() {
      try {
        const res = await fetch("/api/v1/simulator/my-arrays");
        const data = await res.json();
        console.log(data)
        setArrays(data.arrays || []);
        if (data.arrays?.length > 0) {
          setSelectedArrayId(data.arrays[0].id);
        }
      } catch {
        // Silent
      } finally {
        setIsLoadingArrays(false);
      }
    }
    fetchArrays();
  }, []);

  // Auto-calibrate telemetry defaults when array changes
  useEffect(() => {
    if (!selectedArray) return;
    const panelCount = selectedArray.panelSpecs.panelCount;
    const wattage = selectedArray.panelSpecs.individualPanelWattage;

    const expectedDc = (panelCount * wattage) / 1000;
    const expectedAc = (expectedDc * selectedArray.inverterSpecs.efficiency) / 100;

    setTelemetry({
      currentOutputKw: Math.round(expectedAc * 0.85 * 100) / 100,
      irradiance: 800,
      efficiency: selectedArray.inverterSpecs.efficiency / 100,
      inverterTempC: 42,
      voltage: 380,
      current: Math.round(((expectedAc * 0.85 * 1000) / 380) * 100) / 100,
    });
  }, [selectedArray]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const sendTelemetry = useCallback(async (): Promise<IngestionResult> => {
    if (!selectedArray) {
      return { timestamp: new Date().toISOString(), success: false, error: "No array selected" };
    }

    const apiKey = apiKeys[selectedArray.id];
    if (!apiKey) {
      return {
        timestamp: new Date().toISOString(),
        success: false,
        error: "Enter the API key for this array first",
      };
    }

    try {
      const res = await fetch("/api/v1/telemetry/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          currentPowerKw: telemetry.currentOutputKw,
          voltageVolts: telemetry.voltage,
          currentAmperes: telemetry.current,
          inverterTempCelsius: telemetry.inverterTempC,
          dailyKwhAccumulated: telemetry.currentOutputKw * 4,
          sensorIrradianceWm2: telemetry.irradiance,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        return {
          timestamp: new Date().toISOString(),
          success: true,
          diagnostic: data.diagnostic,
        };
      } else {
        return {
          timestamp: new Date().toISOString(),
          success: false,
          error: data.error?.message || data.error || "Request failed",
        };
      }
    } catch (err: any) {
      return {
        timestamp: new Date().toISOString(),
        success: false,
        error: err.message || "Network error",
      };
    }
  }, [selectedArray, apiKeys, telemetry]);

  const handleSingleSend = useCallback(async () => {
    setIsSimulating(true);
    const result = await sendTelemetry();
    setResults((prev) => [result, ...prev].slice(0, 50));
    setIsSimulating(false);
  }, [sendTelemetry]);

  const toggleAutoMode = useCallback(
    (enabled: boolean) => {
      setAutoMode(enabled);
      if (enabled) {
        intervalRef.current = setInterval(async () => {
          const result = await sendTelemetry();
          setResults((prev) => [result, ...prev].slice(0, 50));
        }, intervalMs);
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    },
    [sendTelemetry, intervalMs]
  );

  // Apply a scenario preset
  const applyPreset = (preset: string) => {
    switch (preset) {
      case "peak":
        setTelemetry({ currentOutputKw: 4.5, irradiance: 1000, efficiency: 0.95, inverterTempC: 38, voltage: 385, current: 11.69 });
        break;
      case "cloudy":
        setTelemetry({ currentOutputKw: 1.8, irradiance: 350, efficiency: 0.88, inverterTempC: 30, voltage: 370, current: 4.86 });
        break;
      case "soiling":
        setTelemetry({ currentOutputKw: 3.2, irradiance: 850, efficiency: 0.78, inverterTempC: 44, voltage: 375, current: 8.53 });
        break;
      case "fault":
        setTelemetry({ currentOutputKw: 0.5, irradiance: 900, efficiency: 0.15, inverterTempC: 55, voltage: 320, current: 1.56 });
        break;
      case "night":
        setTelemetry({ currentOutputKw: 0, irradiance: 0, efficiency: 0, inverterTempC: 22, voltage: 0, current: 0 });
        break;
    }
  };

  const hasKey = !!currentApiKey;

  return (
    <div className="space-y-6">
      {/* Array Selector + API Key Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Radio className="h-5 w-5" />
                Telemetry Simulator Console
              </CardTitle>
              <CardDescription>
                Select an array and enter its API key to simulate telemetry
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {isLoadingArrays ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Select value={selectedArrayId} onValueChange={setSelectedArrayId}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Select an array" />
                  </SelectTrigger>
                  <SelectContent>
                    {arrays.map((arr) => (
                      <SelectItem key={arr.id} value={arr.id}>
                        <div className="flex items-center gap-2">
                          <span>{arr.systemName}</span>
                          <Badge variant={apiKeys[arr.id] ? "success" : "outline"} className="text-[10px] px-1">
                            {apiKeys[arr.id] ? "Key Set" : "No Key"}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Array Spec Summary */}
          {selectedArray && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Capacity</p>
                <p className="font-medium">{selectedArray.panelSpecs.totalCapacityKw} kW</p>
              </div>
              <div>
                <p className="text-muted-foreground">Panels</p>
                <p className="font-medium">
                  {selectedArray.panelSpecs.panelCount} x {selectedArray.panelSpecs.individualPanelWattage}W
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Inverter</p>
                <p className="font-medium">
                  {selectedArray.inverterSpecs.brand} ({selectedArray.inverterSpecs.maxCapacityKw} kW)
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Location</p>
                <p className="font-medium">{selectedArray.location.city}</p>
              </div>
            </div>
          )}

          {/* API Key Input */}
          {selectedArray && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Key className="h-3.5 w-3.5" /> API Key for {selectedArray.systemName}
                </Label>
                {currentApiKey && (
                  <Badge variant="success" className="text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Key Set
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKeyInput[selectedArrayId] ? "text" : "password"}
                    placeholder="sv_... (paste your array API key)"
                    value={currentApiKey}
                    onChange={(e) =>
                      setApiKeys((prev) => ({ ...prev, [selectedArrayId]: e.target.value }))
                    }
                    className="font-mono text-sm pr-10"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-10"
                    onClick={() =>
                      setShowKeyInput((prev) => ({
                        ...prev,
                        [selectedArrayId]: !prev[selectedArrayId],
                      }))
                    }
                  >
                    {showKeyInput[selectedArrayId] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {currentApiKey && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      await navigator.clipboard.writeText(currentApiKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                  >
                    {copiedKey ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Find this key in Settings &gt; API Keys, or from the installation creation response.
                It is never stored in your browser — only held in memory for this session.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Telemetry Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Telemetry Inputs</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => applyPreset("peak")}>
                <Sun className="h-3 w-3 mr-1" /> Peak Clear
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("cloudy")}>
                Cloudy
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("soiling")}>
                Soiling
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("fault")}>
                <AlertTriangle className="h-3 w-3 mr-1" /> Fault
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("night")}>
                Night
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Power Output */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Zap className="h-3.5 w-3.5 text-green-600" /> Output Power
                </Label>
                <span className="text-sm font-mono font-medium">{telemetry.currentOutputKw} kW</span>
              </div>
              <Slider
                value={[telemetry.currentOutputKw]}
                onValueChange={([v]) => setTelemetry((p) => ({ ...p, currentOutputKw: v }))}
                min={0}
                max={selectedArray?.inverterSpecs.maxCapacityKw || 10}
                step={0.1}
              />
            </div>

            {/* Irradiance */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Sun className="h-3.5 w-3.5 text-yellow-600" /> Irradiance (W/m²)
                </Label>
                <span className="text-sm font-mono font-medium">{telemetry.irradiance}</span>
              </div>
              <Slider
                value={[telemetry.irradiance]}
                onValueChange={([v]) => setTelemetry((p) => ({ ...p, irradiance: v }))}
                min={0}
                max={1200}
                step={10}
              />
            </div>

            {/* Inverter Efficiency */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Gauge className="h-3.5 w-3.5 text-blue-600" /> Efficiency
                </Label>
                <span className="text-sm font-mono font-medium">
                  {(telemetry.efficiency * 100).toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[telemetry.efficiency * 100]}
                onValueChange={([v]) => setTelemetry((p) => ({ ...p, efficiency: v / 100 }))}
                min={0}
                max={100}
                step={1}
              />
            </div>

            {/* Inverter Temperature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Thermometer className="h-3.5 w-3.5 text-orange-600" /> Inverter Temp
                </Label>
                <span className="text-sm font-mono font-medium">{telemetry.inverterTempC}°C</span>
              </div>
              <Slider
                value={[telemetry.inverterTempC]}
                onValueChange={([v]) => setTelemetry((p) => ({ ...p, inverterTempC: v }))}
                min={0}
                max={80}
                step={1}
              />
            </div>

            {/* Voltage & Current */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Voltage (V)</Label>
                <Input
                  type="number"
                  value={telemetry.voltage}
                  onChange={(e) =>
                    setTelemetry((p) => ({ ...p, voltage: Number(e.target.value) }))
                  }
                  min={0}
                  step={1}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Current (A)</Label>
                <Input
                  type="number"
                  value={telemetry.current}
                  onChange={(e) =>
                    setTelemetry((p) => ({ ...p, current: Number(e.target.value) }))
                  }
                  min={0}
                  step={0.1}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Execution & Results */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Ingestion Pipeline</CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={autoMode} onCheckedChange={toggleAutoMode} />
                  <Label className="text-sm">Auto</Label>
                </div>
                {autoMode && (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={intervalMs / 1000}
                      onChange={(e) => {
                        const sec = Number(e.target.value);
                        setIntervalMs(sec * 1000);
                        if (autoMode) {
                          toggleAutoMode(false);
                          toggleAutoMode(true);
                        }
                      }}
                      min={1}
                      max={60}
                      className="w-16 h-8 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">sec</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Send Button */}
            <Button
              onClick={handleSingleSend}
              disabled={isSimulating || !selectedArray || !hasKey}
              className="w-full"
              size="lg"
            >
              {isSimulating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {autoMode ? "Running..." : hasKey ? "Send Telemetry" : "Enter API Key First"}
            </Button>

            {!hasKey && selectedArray && (
              <p className="text-xs text-center text-muted-foreground">
                Enter the API key for {selectedArray.systemName} above to start sending telemetry.
              </p>
            )}

            {/* Results Log */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {results.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No telemetry sent yet. Enter your API key and click Send.
                </div>
              )}
              {results.map((result, idx) => (
                <div
                  key={`${result.timestamp}-${idx}`}
                  className={`rounded-lg border p-3 text-sm ${
                    result.success
                      ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                      : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                      )}
                      <span className="font-mono text-xs">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {result.diagnostic && (
                      <Badge
                        variant={
                          result.diagnostic.faultCategory === "OPTIMAL"
                            ? "success"
                            : result.diagnostic.faultCategory === "HARDWARE_FAULT"
                            ? "destructive"
                            : "warning"
                        }
                      >
                        {result.diagnostic.faultCategory}
                      </Badge>
                    )}
                  </div>
                  {result.diagnostic && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      PR: {(result.diagnostic.performanceRatio * 100).toFixed(1)}% —{" "}
                      {result.diagnostic.alertMessage}
                    </p>
                  )}
                  {result.error && (
                    <p className="mt-1 text-xs text-red-600">{result.error}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
