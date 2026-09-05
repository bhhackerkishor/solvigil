"use client";

import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

interface TimeSeriesPoint {
  timestamp: string | Date;
  actualPower: number;
  expectedPower: number;
  ghi: number;
}

interface PowerChartProps {
  data: TimeSeriesPoint[];
}

export default function PowerChart({ data }: PowerChartProps) {
  const chartData = data.map((point) => ({
    time: format(new Date(point.timestamp), "HH:mm"),
    "Actual (kW)": point.actualPower,
    "Expected (kW)": point.expectedPower,
    "Irradiance (W/m²)": point.ghi,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Power Output vs Satellite Expected</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No telemetry data available yet. Data will appear once your inverter starts streaming.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="time" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="power" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="irradiance" orientation="right" tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="Actual (kW)"
                stroke="#16a34a"
                fill="#16a34a"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="Expected (kW)"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.1}
                strokeWidth={2}
                strokeDasharray="5 5"
              />
              <Area
                yAxisId="irradiance"
                type="monotone"
                dataKey="Irradiance (W/m²)"
                stroke="#eab308"
                fill="#eab308"
                fillOpacity={0.05}
                strokeWidth={1}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
