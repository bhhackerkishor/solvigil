"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DailyAggregate {
  date: string;
  averagePR: number;
  averagePower: number;
  averageExpected: number;
  totalLossKw: number;
  totalFinancialLossINR: number;
}

interface FaultHistoryChartProps {
  data: DailyAggregate[];
}

const faultColors: Record<string, string> = {
  OPTIMAL: "#16a34a",
  WEATHER_AFFECTED: "#3b82f6",
  SOILING_ALERT: "#eab308",
  HARDWARE_FAULT: "#dc2626",
  UNKNOWN: "#9ca3af",
};

export default function FaultHistoryChart({ data }: FaultHistoryChartProps) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    "Actual (kW)": d.averagePower,
    "Expected (kW)": d.averageExpected,
    "Loss (kW)": d.totalLossKw,
    "PR %": d.averagePR * 100,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Performance History</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No historical data available yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="power" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="pr" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <ReferenceLine yAxisId="pr" y={85} stroke="#16a34a" strokeDasharray="3 3" label="85% PR Target" />
              <Bar yAxisId="power" dataKey="Expected (kW)" fill="#3b82f6" fillOpacity={0.3} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="power" dataKey="Actual (kW)" fill="#16a34a" radius={[2, 2, 0, 0]} />
              <Bar yAxisId="power" dataKey="Loss (kW)" fill="#dc2626" fillOpacity={0.6} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
