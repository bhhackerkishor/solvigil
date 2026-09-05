"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, Gauge, Sun, IndianRupee } from "lucide-react";

interface StatCardsProps {
  currentPower: number;
  performanceRatio: number;
  satelliteIrradiance: number;
  financialLoss: number;
}

export default function StatCards({
  currentPower,
  performanceRatio,
  satelliteIrradiance,
  financialLoss,
}: StatCardsProps) {
  const stats = [
    {
      title: "Current Output",
      value: `${currentPower.toFixed(2)} kW`,
      icon: <Zap className="h-4 w-4 text-green-600" />,
      description: "Real-time power generation",
    },
    {
      title: "Performance Ratio",
      value: `${(performanceRatio * 100).toFixed(1)}%`,
      icon: <Gauge className="h-4 w-4 text-blue-600" />,
      description: "Actual vs Expected output",
    },
    {
      title: "Satellite Irradiance",
      value: `${satelliteIrradiance.toFixed(0)} W/m²`,
      icon: <Sun className="h-4 w-4 text-yellow-600" />,
      description: "Global Horizontal Irradiance",
    },
    {
      title: "Financial Loss",
      value: `₹${financialLoss.toFixed(0)}/day`,
      icon: <IndianRupee className="h-4 w-4 text-red-600" />,
      description: "Estimated revenue impact",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
            {stat.icon}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
            <p className="text-xs text-muted-foreground">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
