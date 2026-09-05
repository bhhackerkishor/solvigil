"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cpu, Send, Zap, Cloud, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SimulatorProps {
  apiKey: string;
  onTelemetrySent: () => void;
}

export default function SimulatorControlPanel({ apiKey, onTelemetrySent }: SimulatorProps) {
  const [isSending, setIsSending] = useState(false);
  const [lastResponse, setLastResponse] = useState<any>(null);

  const injectTelemetry = async (scenario: "OPTIMAL" | "SOILING" | "CLOUDY" | "HARDWARE_FAULT") => {
    setIsSending(true);
    
    // Generate preset metrics based on scenario
    let power = 4.2;
    let voltage = 362.0;
    let current = 11.6;
    let sensorIrradiance = 890;

    if (scenario === "SOILING") {
      power = 2.9; // 30% yield loss under clear skies
      current = 8.0;
    } else if (scenario === "CLOUDY") {
      power = 1.4; // Low power output due to low irradiance
      sensorIrradiance = 320;
      current = 3.8;
    } else if (scenario === "HARDWARE_FAULT") {
      power = 1.8; // Low power output despite high clear-sky irradiance
      sensorIrradiance = 910;
      current = 4.9;
    }

    try {
      const res = await fetch("/api/telemetry/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          currentPowerKw: power,
          voltageVolts: voltage,
          currentAmperes: current,
          dailyKwhAccumulated: 18.5,
          inverterTempCelsius: 38.5,
          sensorIrradianceWm2: sensorIrradiance,
        }),
      });

      const data = await res.json();
      setLastResponse(data);
      onTelemetrySent(); // Refresh main dashboard charts
    } catch (err) {
      console.error("Failed to inject simulation", err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="border-dashed border-2 border-primary/20 bg-muted/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">
              Live Hardware & Telemetry Simulator
            </CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            API Key: {apiKey ? `${apiKey.slice(0, 8)}...` : "None"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Simulate real-time stream payloads from an ESP32 or smart inverter into your backend engine to test live fault detection.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-green-500/50 hover:bg-green-500/10"
            disabled={isSending || !apiKey}
            onClick={() => injectTelemetry("OPTIMAL")}
          >
            <CheckCircle2 className="h-4 w-4 text-green-600 mr-1.5" />
            1. Clear Sky (Normal)
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-yellow-500/50 hover:bg-yellow-500/10"
            disabled={isSending || !apiKey}
            onClick={() => injectTelemetry("SOILING")}
          >
            <Zap className="h-4 w-4 text-yellow-600 mr-1.5" />
            2. Dust / Soiling Drop
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-blue-500/50 hover:bg-blue-500/10"
            disabled={isSending || !apiKey}
            onClick={() => injectTelemetry("CLOUDY")}
          >
            <Cloud className="h-4 w-4 text-blue-600 mr-1.5" />
            3. Heavy Cloud Overcast
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-red-500/50 hover:bg-red-500/10"
            disabled={isSending || !apiKey}
            onClick={() => injectTelemetry("HARDWARE_FAULT")}
          >
            <AlertTriangle className="h-4 w-4 text-red-600 mr-1.5" />
            4. Hardware Fault
          </Button>
        </div>

        {lastResponse && (
          <div className="p-3 bg-background rounded-md border text-xs space-y-1 font-mono">
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Timestamp: {new Date(lastResponse.timestamp).toLocaleTimeString()}</span>
              <span className="font-semibold text-primary">
                Category: {lastResponse.diagnostic?.faultCategory}
              </span>
            </div>
            <div>
              Actual Power: <span className="font-bold">{lastResponse.telemetry?.currentPowerKw} kW</span> | 
              Expected: <span className="font-bold">{lastResponse.diagnostic?.expectedPowerKw} kW</span> | 
              PR: <span className="font-bold">{(lastResponse.diagnostic?.performanceRatio * 100).toFixed(1)}%</span>
            </div>
            <div className="text-muted-foreground italic">
              "{lastResponse.diagnostic?.alertMessage}"
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}