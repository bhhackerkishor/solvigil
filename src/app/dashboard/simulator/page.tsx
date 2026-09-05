"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Cpu,
  Send,
  Sun,
  Cloud,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Thermometer,
  Eye,
  EyeOff,
  Play,
  RotateCcw,
  ArrowLeft,
  Copy,
  Check,
  Gauge,
  Activity,
  Radio,
  Loader2,
  Key,
  Building2,
} from "lucide-react";
import InputAnalyticsPanel from "@/components/dashboard/InputAnalyticsPanel";
import DiagnosticAccuracyTab from "@/components/dashboard/DiagnosticAccuracyTab";
import SimulatorConsole from "@/components/dashboard/SimulatorConsole";
import {
  classifyFault,
  calculateExpectedPower,
  calculatePR,
  type ClassifierResult,
} from "@/lib/diagnostics/classifyFault";

// ── Interfaces ────────────────────────────────────────────────────────

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

interface SimulationState {
  ghi: number;
  ambientTempC: number;
  soilingPercent: number;
  ageYears: number;
  inverterEfficiency: number;
}

interface ScenarioPreset {
  name: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  hoverColor: string;
  description: string;
  expectedCategory: string;
  regionalPR: number;
  prHistory: number[];
  getParams: (capacityKw: number, baseEfficiency: number) => {
    ghi: number;
    ambientTempC: number;
    soilingPercent: number;
    ageYears: number;
    inverterEfficiency: number;
  };
}

// ── Dynamic Scenario Presets ─────────────────────────────────────────

const SCENARIOS: ScenarioPreset[] = [
  {
    name: "Peak Clear Day",
    icon: <Sun className="h-4 w-4" />,
    color: "text-green-600",
    borderColor: "border-green-500/50",
    hoverColor: "hover:bg-green-500/10",
    description: "GHI 950 W/m², Temp 28°C — OPTIMAL performance state",
    expectedCategory: "OPTIMAL",
    regionalPR: 0.91,
    prHistory: [0.90, 0.89, 0.91, 0.90, 0.90],
    getParams: (_, eff) => ({
      ghi: 950,
      ambientTempC: 28,
      soilingPercent: 0,
      ageYears: 0,
      inverterEfficiency: eff,
    }),
  },
  {
    name: "Heavy Cloud Cover",
    icon: <Cloud className="h-4 w-4" />,
    color: "text-blue-600",
    borderColor: "border-blue-500/50",
    hoverColor: "hover:bg-blue-500/10",
    description: "GHI 320 W/m², Temp 25°C — WEATHER_AFFECTED (Suppresses false alerts)",
    expectedCategory: "WEATHER_AFFECTED",
    regionalPR: 0.55,
    prHistory: [0.58, 0.55, 0.60, 0.54, 0.56],
    getParams: (_, eff) => ({
      ghi: 320,
      ambientTempC: 25,
      soilingPercent: 0,
      ageYears: 0,
      inverterEfficiency: eff,
    }),
  },
  {
    name: "Severe Soiling / Dust",
    icon: <Eye className="h-4 w-4" />,
    color: "text-yellow-600",
    borderColor: "border-yellow-500/50",
    hoverColor: "hover:bg-yellow-500/10",
    description: "GHI 850 W/m², Temp 32°C, 25% output drop — SOILING_ALERT",
    expectedCategory: "SOILING_ALERT",
    regionalPR: 0.88,
    prHistory: [0.84, 0.80, 0.76, 0.73, 0.70],
    getParams: (_, eff) => ({
      ghi: 850,
      ambientTempC: 32,
      soilingPercent: 25,
      ageYears: 0,
      inverterEfficiency: eff,
    }),
  },
  {
    name: "Inverter Fault / Clip",
    icon: <Zap className="h-4 w-4" />,
    color: "text-red-600",
    borderColor: "border-red-500/50",
    hoverColor: "hover:bg-red-500/10",
    description: "GHI 900 W/m², Temp 30°C, 0% inverter efficiency — HARDWARE_FAULT",
    expectedCategory: "HARDWARE_FAULT",
    regionalPR: 0.89,
    prHistory: [0.88, 0.87, 0.40, 0.01, 0.00],
    getParams: () => ({
      ghi: 900,
      ambientTempC: 30,
      soilingPercent: 0,
      ageYears: 0,
      inverterEfficiency: 0,
    }),
  },
  {
    name: "Extreme Heat Derating",
    icon: <Thermometer className="h-4 w-4" />,
    color: "text-orange-600",
    borderColor: "border-orange-500/50",
    hoverColor: "hover:bg-orange-500/10",
    description: "GHI 900 W/m², Temp 48°C — Thermal derating calculation test",
    expectedCategory: "OPTIMAL",
    regionalPR: 0.78,
    prHistory: [0.77, 0.76, 0.75, 0.74, 0.73],
    getParams: (_, eff) => ({
      ghi: 900,
      ambientTempC: 48,
      soilingPercent: 0,
      ageYears: 0,
      inverterEfficiency: eff,
    }),
  },
];

// ── Main Component ───────────────────────────────────────────────────

export default function SimulatorPage() {
  // Installations Data
  const [arrays, setArrays] = useState<ArrayConfig[]>([]);
  const [selectedArrayId, setSelectedArrayId] = useState<string>("");
  const [isLoadingArrays, setIsLoadingArrays] = useState(true);

  // Api Keys State (Key per installation stored in memory)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeyInput, setShowKeyInput] = useState<Record<string, boolean>>({});

  // Simulation Controls State
  const [simState, setSimState] = useState<SimulationState>({
    ghi: 800,
    ambientTempC: 30,
    soilingPercent: 0,
    ageYears: 0,
    inverterEfficiency: 96,
  });

  const [regionalPR, setRegionalPR] = useState(0.85);
  const [prHistory, setPrHistory] = useState<number[]>([0.82, 0.80, 0.78, 0.76, 0.74]);
  const [isSending, setIsSending] = useState(false);
  const [lastResponse, setLastResponse] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("sandbox");

  // Retrieve current active plant configuration
  const activePlant = useMemo(() => {
    return arrays.find((a) => a.id === selectedArrayId) || null;
  }, [arrays, selectedArrayId]);

  const plantCapacityKw = useMemo(() => {
    return activePlant?.panelSpecs?.totalCapacityKw || 5.0;
  }, [activePlant]);

  const baseInverterEfficiency = useMemo(() => {
    return activePlant?.inverterSpecs?.efficiency || 96;
  }, [activePlant]);

  // Fetch installations on mount
  useEffect(() => {
    async function fetchArrays() {
      try {
        const res = await fetch("/api/v1/simulator/my-arrays");
        const data = await res.json();
        const fetchedArrays: ArrayConfig[] = data.arrays || [];
        setArrays(fetchedArrays);
        if (fetchedArrays.length > 0) {
          setSelectedArrayId(fetchedArrays[0].id);
        }
      } catch (err) {
        console.error("Failed to load user solar installations:", err);
      } finally {
        setIsLoadingArrays(false);
      }
    }
    fetchArrays();
  }, []);

  // Recalibrate simulation parameters whenever active plant changes
  useEffect(() => {
    if (!activePlant) return;
    setSimState({
      ghi: 800,
      ambientTempC: 30,
      soilingPercent: 0,
      ageYears: 0,
      inverterEfficiency: activePlant.inverterSpecs.efficiency || 96,
    });
    setLastResponse(null);
  }, [activePlant]);

  // Compute Actual Output Power based on parameters and system capacity
  const actualPowerKw = useMemo(() => {
    const expected = calculateExpectedPower(
      plantCapacityKw,
      simState.ghi,
      simState.ambientTempC,
      simState.ageYears,
      simState.inverterEfficiency / 100
    );
    const soilingFactor = 1 - simState.soilingPercent / 100;
    return Math.max(0, Math.round(expected * soilingFactor * 1000) / 1000);
  }, [simState, plantCapacityKw]);

  // Execute Local Classifier Engine
  const classifierResult: ClassifierResult = useMemo(() => {
    const expected = calculateExpectedPower(
      plantCapacityKw,
      simState.ghi,
      simState.ambientTempC,
      simState.ageYears,
      simState.inverterEfficiency / 100
    );
    const pr = calculatePR(actualPowerKw, expected);

    return classifyFault({
      currentPlantPR: pr,
      regionalAveragePR: regionalPR,
      ghi: simState.ghi,
      cellTemp: simState.ambientTempC + 15,
      currentPowerKw: actualPowerKw,
      expectedPowerKw: expected,
      prHistory,
      plantCapacityKw,
    });
  }, [simState, actualPowerKw, regionalPR, prHistory, plantCapacityKw]);

  // Generate Ingestion Payload
  const apiPayload = useMemo(() => {
    const voltage = 380 + (Math.random() - 0.5) * 4;
    const current = actualPowerKw > 0 ? (actualPowerKw * 1000) / voltage : 0;
    return {
      currentPowerKw: actualPowerKw,
      voltageVolts: Math.round(voltage * 10) / 10,
      currentAmperes: Math.round(current * 100) / 100,
      dailyKwhAccumulated: Math.round(actualPowerKw * 4.5 * 100) / 100,
      inverterTempCelsius: Math.round(
        (simState.ambientTempC + actualPowerKw * 3 + (Math.random() - 0.5) * 2) * 10
      ) / 10,
      sensorIrradianceWm2: simState.ghi,
    };
  }, [actualPowerKw, simState]);

  // Apply Scenario Presets dynamically
  const applyPreset = useCallback(
    (preset: ScenarioPreset) => {
      setSimState(preset.getParams(plantCapacityKw, baseInverterEfficiency));
      setRegionalPR(preset.regionalPR);
      setPrHistory([...preset.prHistory]);
      setLastResponse(null);
    },
    [plantCapacityKw, baseInverterEfficiency]
  );

  // Telemetry Injection
  const injectTelemetry = useCallback(async () => {
    if (!selectedArrayId) {
      setLastResponse({ error: "Please select an installation first." });
      return;
    }

    const apiKey =
      apiKeys[selectedArrayId] ||
      localStorage.getItem("solvigil_api_key") ||
      process.env.NEXT_PUBLIC_SOLVIGIL_API_KEY ||
      "";

    if (!apiKey) {
      setLastResponse({
        error: "API Key missing. Enter your installation API Key to proceed.",
      });
      return;
    }

    setIsSending(true);
    try {
      const res = await fetch("/api/v1/telemetry/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(apiPayload),
      });
      const data = await res.json();
      setLastResponse(data);
    } catch (err: any) {
      console.error("Inject telemetry failed:", err);
      setLastResponse({ error: err.message || "Network error while calling stream endpoint." });
    } finally {
      setIsSending(false);
    }
  }, [apiPayload, apiKeys, selectedArrayId]);

  // Copy Payload
  const copyPayload = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(apiPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [apiPayload]);

  // Slider Update Helper
  const updateSlider = (key: keyof SimulationState, value: number[]) => {
    setSimState((prev) => ({ ...prev, [key]: value[0] }));
  };

  const categoryColor: Record<string, string> = {
    OPTIMAL: "bg-green-100 text-green-800 border-green-300",
    WEATHER_AFFECTED: "bg-blue-100 text-blue-800 border-blue-300",
    SOILING_ALERT: "bg-yellow-100 text-yellow-800 border-yellow-300",
    HARDWARE_FAULT: "bg-red-100 text-red-800 border-red-300",
    UNKNOWN: "bg-gray-100 text-gray-800 border-gray-300",
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cpu className="h-6 w-6 text-primary" />
              Physics &amp; Fault Simulation Sandbox
            </h1>
            <p className="text-sm text-muted-foreground">
              Interactive testbed for environmental inputs, hardware anomalies, and fault disambiguation
            </p>
          </div>
        </div>

        {/* Dynamic Plant Selection dropdown */}
        <div className="flex items-center gap-2">
          {isLoadingArrays ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading installations...
            </div>
          ) : arrays.length > 0 ? (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedArrayId} onValueChange={setSelectedArrayId}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Select Solar Plant" />
                </SelectTrigger>
                <SelectContent>
                  {arrays.map((arr) => (
                    <SelectItem key={arr.id} value={arr.id}>
                      {arr.systemName} ({arr.panelSpecs.totalCapacityKw} kW)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              No registered installations found
            </Badge>
          )}
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="sandbox" className="gap-1">
            <Play className="h-3.5 w-3.5" /> Sandbox
          </TabsTrigger>
          <TabsTrigger value="accuracy" className="gap-1">
            <Activity className="h-3.5 w-3.5" /> Model Validation
          </TabsTrigger>
          <TabsTrigger value="ingestion" className="gap-1">
            <Radio className="h-3.5 w-3.5" /> Ingestion Console
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* TAB 1: SANDBOX                                              */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="sandbox" className="space-y-6">
          {/* Plant Metadata Bar */}
          {activePlant && (
            <Card className="bg-muted/30">
              <CardContent className="py-3 px-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-muted-foreground">Selected Plant:</span>{" "}
                    <strong className="text-foreground">{activePlant.systemName}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>{" "}
                    <strong className="text-foreground">{activePlant.location.city}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Rating:</span>{" "}
                    <strong className="text-foreground">{activePlant.panelSpecs.totalCapacityKw} kW DC</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Inverter:</span>{" "}
                    <strong className="text-foreground">
                      {activePlant.inverterSpecs.brand} ({activePlant.inverterSpecs.efficiency}%)
                    </strong>
                  </div>
                </div>

                {/* API Key Inline Controls */}
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type={showKeyInput[activePlant.id] ? "text" : "password"}
                    placeholder="Enter x-api-key"
                    value={apiKeys[activePlant.id] || ""}
                    onChange={(e) =>
                      setApiKeys((prev) => ({ ...prev, [activePlant.id]: e.target.value }))
                    }
                    className="h-7 w-48 text-xs font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() =>
                      setShowKeyInput((prev) => ({
                        ...prev,
                        [activePlant.id]: !prev[activePlant.id],
                      }))
                    }
                  >
                    {showKeyInput[activePlant.id] ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid lg:grid-cols-12 gap-6">
            {/* Left Column: Controls */}
            <div className="lg:col-span-5 space-y-5">
              {/* Scenario Presets */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Scenario Presets (1-Click)</CardTitle>
                  <CardDescription className="text-xs">
                    Select a pre-configured environmental + fault scenario
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {SCENARIOS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => applyPreset(preset)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg border ${preset.borderColor} ${preset.hoverColor} transition-colors text-left`}
                    >
                      <span className={`mt-0.5 ${preset.color}`}>{preset.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{preset.name}</span>
                          <Badge variant="outline" className="text-[10px] ml-2">
                            → {preset.expectedCategory}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>

              {/* Interactive Sliders */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Interactive Control Sliders</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSimState({
                          ghi: 800,
                          ambientTempC: 30,
                          soilingPercent: 0,
                          ageYears: 0,
                          inverterEfficiency: baseInverterEfficiency,
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Irradiance */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label className="flex items-center gap-1.5">
                        <Sun className="h-3.5 w-3.5 text-yellow-500" /> Irradiance (GHI)
                      </Label>
                      <span className="font-mono font-semibold">{simState.ghi} W/m²</span>
                    </div>
                    <Slider
                      value={[simState.ghi]}
                      onValueChange={(v) => updateSlider("ghi", v)}
                      min={0}
                      max={1200}
                      step={10}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0 (Night)</span>
                      <span>600 (Overcast)</span>
                      <span>1000 (STC)</span>
                      <span>1200 (Peak)</span>
                    </div>
                  </div>

                  {/* Temperature */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label className="flex items-center gap-1.5">
                        <Thermometer className="h-3.5 w-3.5 text-orange-500" /> Ambient Temperature
                      </Label>
                      <span className="font-mono font-semibold">{simState.ambientTempC}°C</span>
                    </div>
                    <Slider
                      value={[simState.ambientTempC]}
                      onValueChange={(v) => updateSlider("ambientTempC", v)}
                      min={0}
                      max={60}
                      step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0°C</span>
                      <span>25°C (STC)</span>
                      <span>45°C (Hot)</span>
                      <span>60°C</span>
                    </div>
                  </div>

                  {/* Soiling */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label className="flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5 text-amber-500" /> Panel Soiling Factor
                      </Label>
                      <span className="font-mono font-semibold">{simState.soilingPercent}% loss</span>
                    </div>
                    <Slider
                      value={[simState.soilingPercent]}
                      onValueChange={(v) => updateSlider("soilingPercent", v)}
                      min={0}
                      max={50}
                      step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0% (Clean)</span>
                      <span>25% (Dusty)</span>
                      <span>50% (Heavy soil)</span>
                    </div>
                  </div>

                  {/* Age Degradation */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label className="flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-purple-500" /> Panel Age (Degradation)
                      </Label>
                      <span className="font-mono font-semibold">
                        {simState.ageYears} yrs ({(simState.ageYears * 0.5).toFixed(1)}% loss)
                      </span>
                    </div>
                    <Slider
                      value={[simState.ageYears]}
                      onValueChange={(v) => updateSlider("ageYears", v)}
                      min={0}
                      max={25}
                      step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0 yrs (New)</span>
                      <span>12 yrs</span>
                      <span>25 yrs (EOL)</span>
                    </div>
                  </div>

                  {/* Inverter Efficiency */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label className="flex items-center gap-1.5">
                        <Gauge className="h-3.5 w-3.5 text-cyan-500" /> Inverter Efficiency
                      </Label>
                      <span className="font-mono font-semibold">{simState.inverterEfficiency}%</span>
                    </div>
                    <Slider
                      value={[simState.inverterEfficiency]}
                      onValueChange={(v) => updateSlider("inverterEfficiency", v)}
                      min={0}
                      max={100}
                      step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0% (Tripped)</span>
                      <span>{baseInverterEfficiency}% (Rated)</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* Regional PR */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label>Regional Peer Average PR</Label>
                      <span className="font-mono font-semibold">{(regionalPR * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[regionalPR * 100]}
                      onValueChange={(v) => setRegionalPR(v[0] / 100)}
                      min={30}
                      max={100}
                      step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>30% (Grid Outage)</span>
                      <span>70%</span>
                      <span>90% (Healthy Grid)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Results */}
            <div className="lg:col-span-7 space-y-5">
              {/* Live Classification Result */}
              <Card
                className="border-2"
                style={{
                  borderColor:
                    classifierResult.category === "OPTIMAL"
                      ? "#22c55e"
                      : classifierResult.category === "WEATHER_AFFECTED"
                      ? "#3b82f6"
                      : classifierResult.category === "SOILING_ALERT"
                      ? "#eab308"
                      : classifierResult.category === "HARDWARE_FAULT"
                      ? "#ef4444"
                      : "#9ca3af",
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Activity className="h-4 w-4" /> Live Classifier Output
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge className={categoryColor[classifierResult.category]}>
                        {classifierResult.category}
                      </Badge>
                      <Badge variant="outline">
                        {(classifierResult.confidence * 100).toFixed(0)}% confidence
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 bg-muted/50 rounded-lg text-sm">
                    <strong>Reasoning:</strong> {classifierResult.reasoning}
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-sm">
                    <strong>Recommended Action:</strong> {classifierResult.recommendedAction}
                  </div>
                  {classifierResult.financialLossINR > 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                      <strong>Estimated Daily Financial Loss:</strong> ₹
                      {classifierResult.financialLossINR.toLocaleString("en-IN")}/day (₹
                      {(classifierResult.financialLossINR * 30).toLocaleString("en-IN")}/month at ₹6.5/kWh)
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Physics Diagnostics Panel */}
              <InputAnalyticsPanel
                capacityKw={plantCapacityKw}
                ghi={simState.ghi}
                ambientTempC={simState.ambientTempC}
                actualPowerKw={actualPowerKw}
                ageYears={simState.ageYears}
                inverterEfficiency={simState.inverterEfficiency / 100}
                soilingFactor={simState.soilingPercent / 100}
              />

              {/* API Payload Generator */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" /> Live API Payload
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={copyPayload}>
                        {copied ? (
                          <Check className="h-3.5 w-3.5 mr-1" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 mr-1" />
                        )}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                      <Button size="sm" onClick={injectTelemetry} disabled={isSending}>
                        {isSending ? (
                          <RotateCcw className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5 mr-1" />
                        )}
                        Inject Telemetry Stream
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="p-4 bg-black/90 text-green-400 rounded-lg text-xs font-mono overflow-x-auto">
                    {JSON.stringify(apiPayload, null, 2)}
                  </pre>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    POST /api/v1/telemetry/stream with header x-api-key: &lt;your-key&gt;
                  </p>
                </CardContent>
              </Card>

              {/* Last API Response */}
              {lastResponse && (
                <Card className={lastResponse.error ? "border-red-300" : "border-green-300"}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      {lastResponse.error ? (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      Backend Response
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto max-h-48">
                      {JSON.stringify(lastResponse, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* TAB 2: MODEL VALIDATION                                     */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="accuracy">
          <DiagnosticAccuracyTab />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* TAB 3: MULTI-ARRAY INGESTION SIMULATOR                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="ingestion">
          <SimulatorConsole />
        </TabsContent>
      </Tabs>
    </div>
  );
}