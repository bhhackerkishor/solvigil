"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sun, Thermometer, TrendingDown, IndianRupee, Gauge, Zap } from "lucide-react";

/**
 * Standard Test Conditions (STC) reference values
 */
const STC = {
  irradiance: 1000,   // W/m²
  tempCell: 25,       // °C
};

const INR_PER_KWH = 6.5;
const PEAK_SUN_HOURS = 8;
const TEMP_COEFF = -0.004;  // -0.4%/°C for crystalline silicon
const ANNUAL_DEGRADATION = 0.005; // 0.5%/year

export interface InputAnalyticsProps {
  /** Installed system capacity in kW */
  capacityKw: number;
  /** Current irradiance from satellite or sensor (W/m²) */
  ghi: number;
  /** Ambient temperature in °C */
  ambientTempC: number;
  /** Actual measured power output in kW */
  actualPowerKw: number;
  /** Panel age in years (0-25) */
  ageYears?: number;
  /** Inverter efficiency as fraction (0-1) */
  inverterEfficiency?: number;
  /** Soiling loss factor (0-0.5) */
  soilingFactor?: number;
}

interface MetricCard {
  label: string;
  value: string;
  unit: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

/**
 * Calculates theoretical expected power using simplified STC-referenced model.
 *
 * P_expected = Capacity × (GHI/1000) × [1 - max(0, Temp-25) × 0.004] × [1 - Age × 0.005]
 */
function computePhysics(input: InputAnalyticsProps) {
  const irradianceFactor = input.ghi / STC.irradiance;
  const tempDelta = Math.max(0, input.ambientTempC - STC.tempCell);
  const tempDerating = 1 - tempDelta * Math.abs(TEMP_COEFF);
  const ageFactor = 1 - (input.ageYears ?? 0) * ANNUAL_DEGRADATION;
  const soilingFactor = 1 - (input.soilingFactor ?? 0);
  const inverterEff = input.inverterEfficiency ?? 0.96;

  const pExpected = input.capacityKw * irradianceFactor * tempDerating * ageFactor * soilingFactor * inverterEff;

  const pr = pExpected > 0 ? Math.min(1, input.actualPowerKw / pExpected) : 0;
  const efficiencyDelta = Math.max(0, pExpected - input.actualPowerKw);
  const tempLossPercent = tempDelta * Math.abs(TEMP_COEFF) * 100;
  const yieldDeficitPercent = pExpected > 0 ? ((pExpected - input.actualPowerKw) / pExpected) * 100 : 0;
  const lossPerHour = efficiencyDelta * INR_PER_KWH;
  const lossPerMonth = lossPerHour * PEAK_SUN_HOURS * 30;

  return {
    pExpected: Math.round(pExpected * 1000) / 1000,
    pr: Math.round(pr * 100) / 100,
    efficiencyDelta: Math.round(efficiencyDelta * 1000) / 1000,
    tempLossPercent: Math.round(tempLossPercent * 10) / 10,
    yieldDeficitPercent: Math.round(yieldDeficitPercent * 10) / 10,
    lossPerHour: Math.round(lossPerHour * 100) / 100,
    lossPerMonth: Math.round(lossPerMonth),
    irradianceFactor: Math.round(irradianceFactor * 100),
    tempDerating: Math.round(tempDerating * 1000) / 1000,
    ageFactor: Math.round(ageFactor * 1000) / 1000,
  };
}

export default function InputAnalyticsPanel(props: InputAnalyticsProps) {
  const stats = computePhysics(props);

  const metrics: MetricCard[] = [
    {
      label: "Irradiance Factor",
      value: `${stats.irradianceFactor}`,
      unit: "% of STC",
      icon: <Sun className="h-4 w-4" />,
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
    },
    {
      label: "Temperature Derating",
      value: `${stats.tempLossPercent}`,
      unit: "% loss",
      icon: <Thermometer className="h-4 w-4" />,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
    {
      label: "Yield Deficit",
      value: `${stats.yieldDeficitPercent}`,
      unit: "% below expected",
      icon: <TrendingDown className="h-4 w-4" />,
      color: stats.yieldDeficitPercent > 15 ? "text-red-600" : stats.yieldDeficitPercent > 5 ? "text-yellow-600" : "text-green-600",
      bgColor: stats.yieldDeficitPercent > 15 ? "bg-red-50" : stats.yieldDeficitPercent > 5 ? "bg-yellow-50" : "bg-green-50",
    },
    {
      label: "Revenue Leakage Rate",
      value: `₹${stats.lossPerHour.toFixed(2)}`,
      unit: "/hour",
      icon: <IndianRupee className="h-4 w-4" />,
      color: stats.lossPerHour > 10 ? "text-red-600" : "text-green-600",
      bgColor: stats.lossPerHour > 10 ? "bg-red-50" : "bg-green-50",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Physics Diagnostics vs STC
          </CardTitle>
          <Badge variant={stats.pr >= 0.80 ? "success" : stats.pr >= 0.65 ? "warning" : "destructive"}>
            PR: {(stats.pr * 100).toFixed(1)}%
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className={`p-3 rounded-lg ${m.bgColor} border`}>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${m.color} mb-1`}>
                {m.icon}
                {m.label}
              </div>
              <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
              <div className="text-xs text-muted-foreground">{m.unit}</div>
            </div>
          ))}
        </div>

        {/* Detailed Breakdown */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-1">P_theoretical</div>
            <div className="font-mono font-semibold">{stats.pExpected} kW</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-1">P_actual</div>
            <div className="font-mono font-semibold">{props.actualPowerKw} kW</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-1">Efficiency Delta</div>
            <div className="font-mono font-semibold">{stats.efficiencyDelta} kW</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-1">Thermal Derate</div>
            <div className="font-mono font-semibold">{(stats.tempDerating * 100).toFixed(1)}%</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-1">Age Factor</div>
            <div className="font-mono font-semibold">{(stats.ageFactor * 100).toFixed(1)}%</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-1">Projected ₹/Month</div>
            <div className="font-mono font-semibold text-red-600">₹{stats.lossPerMonth.toLocaleString("en-IN")}</div>
          </div>
        </div>

        {/* STC Reference Bar */}
        <div className="p-3 bg-primary/5 border border-primary/10 rounded-lg text-xs text-muted-foreground">
          <strong className="text-foreground">Reference:</strong> STC = {STC.irradiance} W/m² at {STC.tempCell}°C.
          Thermal coeff = {TEMP_COEFF * 100}%/°C. Annual degradation = {ANNUAL_DEGRADATION * 100}%/yr.
          Tariff = ₹{INR_PER_KWH}/kWh × {PEAK_SUN_HOURS} peak hrs/day.
        </div>
      </CardContent>
    </Card>
  );
}
