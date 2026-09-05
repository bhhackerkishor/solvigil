"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StatCards from "@/components/dashboard/StatCards";
import AlertBanner from "@/components/dashboard/AlertBanner";
import PowerChart from "@/components/dashboard/PowerChart";
import FaultHistoryChart from "@/components/dashboard/FaultHistoryChart";
import UpgradeModal from "@/components/dashboard/UpgradeModal";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Loader2,
  RefreshCw,
  Radio,
  Settings,
  Wrench,
  Download,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Leaf,
  Gauge,
  ArrowRight,
  Brain,
  Sun,
  Thermometer,
} from "lucide-react";

import SimulatorControlPanel from "@/components/dashboard/SimulatorControlPanel";

interface Installation {
  id: string;
  systemName: string;
  panelSpecs: { panelCount: number; totalCapacityKw: number };
  hardwareIntegration: { apiKey: string; hasPhysicalIrradianceSensor: boolean };
}

interface AnalyticsData {
  summary: {
    totalLogs: number;
    averagePR: number;
    averagePower: number;
    totalKwh: number;
    totalFinancialLossINR: number;
    currentFaultCategory: string;
  };
  dailyAggregates: any[];
  timeSeriesData: any[];
}

export default function DashboardPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [latestTelemetry, setLatestTelemetry] = useState<any>(null);
  const [period, setPeriod] = useState("7d");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);

  // Auto-refresh control state
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(10000); // Default to 10 seconds

  // 1. Fetch Installations
  useEffect(() => {
    async function loadInstallations() {
      try {
        const res = await fetch("/api/v1/installations");
        const data = await res.json();
        const list = (data.installations || []).map((item: any) => ({
          ...item,
          id: item.id || item._id?.toString(),
        }));

        setInstallations(list);
        if (list.length > 0) {
          setSelectedId(list[0].id);
        }
      } catch {
        /* silent catch */
      } finally {
        setIsLoading(false);
      }
    }
    loadInstallations();
  }, []);

  // 2. Fetch Analytics — fixed to prevent layout flicker during background polling
  const loadAnalytics = useCallback(async (isManualSwitch = false) => {
    if (!selectedId) {
      setAnalytics(null);
      setLatestTelemetry(null);
      return;
    }

    // Only clear data state if explicitly changing selection/period
    if (isManualSwitch) {
      setAnalytics(null);
      setLatestTelemetry(null);
    }
    
    setIsRefreshing(true);

    try {
      const res = await fetch(
        `/api/v1/dashboard/analytics?installationId=${selectedId}&period=${period}&limit=2000`
      );
      const data = await res.json();
      setAnalytics(data);

      if (data.timeSeriesData?.length > 0) {
        setLatestTelemetry(data.timeSeriesData[data.timeSeriesData.length - 1]);
      }
    } catch {
      /* silent catch */
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedId, period]);

  // Trigger explicit clear and reload on installation/period changes
  useEffect(() => {
    loadAnalytics(true);
  }, [selectedId, period, loadAnalytics]);

  // 3. Configurable Polling Interval for live updates
  useEffect(() => {
    if (!selectedId || !isAutoRefresh) return;

    const interval = setInterval(() => {
      loadAnalytics(false);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [selectedId, isAutoRefresh, refreshInterval, loadAnalytics]);

  // 4. Derived variable needed by useMemo
  const currentFault = analytics?.summary?.currentFaultCategory || "OPTIMAL";

  // 5. Hooks
  const perfMetrics = useMemo(() => {
    if (!analytics) return null;
    const ts = analytics.timeSeriesData || [];
    const daily = analytics.dailyAggregates || [];
    const selectedInst = installations.find((i) => i.id === selectedId);
    if (!selectedInst || ts.length === 0) return null;

    const totalKwh = daily.reduce(
      (sum: number, d: any) => sum + (d.averagePower || 0) * 8 * (d.sampleCount || 1), 0
    );
    const totalExpectedKwh = daily.reduce(
      (sum: number, d: any) => sum + (d.averageExpected || 0) * 8 * (d.sampleCount || 1), 0
    );
    const efficiency = totalExpectedKwh > 0 ? (totalKwh / totalExpectedKwh) * 100 : 0;
    const carbonKg = totalKwh * 0.82;

    const yieldData = ts.map((pt: any) => {
      const d = new Date(pt.timestamp);
      const now = new Date();
      const hoursAgo = Math.round((now.getTime() - d.getTime()) / 3600000);

      let timeLabel: string;
      if (hoursAgo < 1) {
        timeLabel = "Just now";
      } else if (hoursAgo < 24) {
        timeLabel = `${hoursAgo}h ago`;
      } else {
        timeLabel = d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
      }

      return {
        time: timeLabel,
        expected: Math.round((pt.expectedPower || 0) * 1000) / 1000,
        actual: Math.round((pt.actualPower || 0) * 1000) / 1000,
        rawTime: d.getTime(),
      };
    });

    const prTrend = daily.map((d: any) => ({
      date: d.date,
      pr: d.averagePR || 0,
      loss: d.totalLossKw || 0,
    }));

    const diagnoses: Array<{
      category: string;
      title: string;
      description: string;
      severity: "critical" | "warning" | "info";
    }> = [];

    const maxKw = selectedInst.panelSpecs.totalCapacityKw;
    const clippingEvents = ts.filter(
      (pt: any) => Math.abs((pt.actualPower || 0) - maxKw) < 0.1 && (pt.expectedPower || 0) > maxKw
    );
    if (clippingEvents.length > 3) {
      diagnoses.push({
        category: "CLIPPING",
        title: "Inverter Power Capping",
        description: `Your panels are producing more power than the inverter can handle. The output is being capped at ${maxKw} kW during peak hours. Consider a larger inverter to capture the lost energy.`,
        severity: "warning",
      });
    }

    if (daily.length >= 3) {
      const recentPRs = daily.slice(-7).map((d: any) => d.averagePR || 0);
      const isDecline = recentPRs.every((pr: number, i: number) => i === 0 || pr <= recentPRs[i - 1] * 1.02);
      const avgRecent = recentPRs.reduce((a: number, b: number) => a + b, 0) / recentPRs.length;
      if (isDecline && avgRecent < 0.75 && avgRecent > 0.3) {
        diagnoses.push({
          category: "SOILING",
          title: "Dust or Dirt Buildup",
          description: `Your panels have been producing less power each day over the past week. This steady decline usually means dust or dirt is covering the panels. A cleaning should restore performance.`,
          severity: "critical",
        });
      }
    }

    if (ts.length > 5) {
      const recentPRs = ts.slice(-10).map((pt: any) => pt.performanceRatio || 0);
      const avgPR = recentPRs.reduce((a: number, b: number) => a + b, 0) / recentPRs.length;
      if (avgPR > 1.15) {
        diagnoses.push({
          category: "SENSOR",
          title: "Sensor Needs Calibration",
          description: `The system is reporting more power than theoretically possible. This usually means the irradiance sensor is miscalibrated and reading lower sunlight than actual.`,
          severity: "info",
        });
      }
    }

    const recommendations: Array<{
      priority: "high" | "medium" | "low";
      title: string;
      description: string;
    }> = [];

    if (diagnoses.find((d) => d.category === "SOILING")) {
      recommendations.push({
        priority: "high",
        title: "Schedule Panel Cleaning",
        description: `Dust is reducing your output. Cleaning now could recover ~₹${Math.round((analytics.summary.totalFinancialLossINR || 0) * 7)}/week in lost generation.`,
      });
    }
    if (diagnoses.find((d) => d.category === "CLIPPING")) {
      recommendations.push({
        priority: "medium",
        title: "Consider Inverter Upgrade",
        description: `Your panels can produce more than the ${maxKw} kW inverter allows. A larger inverter would capture this extra energy.`,
      });
    }
    if (currentFault === "HARDWARE_FAULT") {
      recommendations.push({
        priority: "high",
        title: "Inspect Hardware",
        description: "A serious performance drop has been detected. Check your panels, wiring, and inverter for any visible damage or loose connections.",
      });
    }
    if (recommendations.length === 0 && efficiency > 85) {
      recommendations.push({
        priority: "low",
        title: "Everything Looks Good",
        description: "Your system is running well. No action needed right now.",
      });
    }

    return {
      totalKwh: Math.round(totalKwh),
      efficiency: Math.round(efficiency * 10) / 10,
      carbonKg: Math.round(carbonKg),
      yieldData,
      prTrend,
      diagnoses,
      recommendations,
    };
  }, [analytics, installations, selectedId, currentFault]);

  // Handlers
  const handleDispatchTicket = () => {
    setIsDispatching(true);
    setTimeout(() => {
      setIsDispatching(false);
      setDispatchSuccess(true);
      setTimeout(() => setDispatchSuccess(false), 5000);
    }, 1200);
  };

  if (isLoading) return <DashboardSkeleton />;

  const selectedInstallation = installations.find((i) => i.id === selectedId);

  if (installations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-2xl font-bold">No Installations Found</h2>
        <p className="text-muted-foreground">Register your solar array to start monitoring.</p>
        <Button onClick={() => (window.location.href = "/onboard")}>
          Register Installation
        </Button>
      </div>
    );
  }

  const faultBannerConfig: Record<string, { message: string; color: "green" | "blue" | "yellow" | "red" | "gray" }> = {
    OPTIMAL: { message: "Array operating normally. Output matches expected solar physics curve.", color: "green" },
    WEATHER_AFFECTED: { message: "Generation drop detected due to passing cloud cover. No action needed.", color: "blue" },
    SOILING_ALERT: { message: "SOILING DETECTED: Dust accumulation reducing yield. Schedule automated/manual cleaning.", color: "yellow" },
    HARDWARE_FAULT: { message: "HARDWARE FAULT: Severe generation anomaly under clear sky. Immediate inspection required.", color: "red" },
    UNKNOWN: { message: "Performance below expected baseline. Monitoring for pattern consensus.", color: "gray" },
  };

  const bannerConfig = faultBannerConfig[currentFault] || faultBannerConfig.UNKNOWN;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Solar Command Dashboard</h1>
            <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 px-2.5 py-1 rounded-full border border-emerald-500/20 text-xs font-semibold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              LIVE IoT TELEMETRY
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedInstallation?.systemName} — {selectedInstallation?.panelSpecs.totalCapacityKw} kW Rating
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Auto Refresh Switch */}
          <div className="flex items-center gap-2 bg-muted/50 border px-3 py-1.5 rounded-md">
            <Switch
              id="auto-refresh"
              checked={isAutoRefresh}
              onCheckedChange={setIsAutoRefresh}
            />
            <Label htmlFor="auto-refresh" className="text-xs font-medium cursor-pointer">
              Auto-Refresh
            </Label>
          </div>

          {/* Refresh Interval Selector */}
          {isAutoRefresh && (
            <Select
              value={refreshInterval.toString()}
              onValueChange={(val) => setRefreshInterval(Number(val))}
            >
              <SelectTrigger className="w-[110px]" aria-label="Auto-refresh interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5000">Every 5s</SelectItem>
                <SelectItem value="10000">Every 10s</SelectItem>
                <SelectItem value="30000">Every 30s</SelectItem>
                <SelectItem value="60000">Every 1m</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-[180px]" aria-label="Select installation">
              <SelectValue placeholder="Select installation" />
            </SelectTrigger>
            <SelectContent>
              {installations.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.systemName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[100px]" aria-label="Select time period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24 Hours</SelectItem>
              <SelectItem value="7d">7 Days</SelectItem>
              <SelectItem value="30d">30 Days</SelectItem>
              <SelectItem value="90d">90 Days</SelectItem>
            </SelectContent>
          </Select>

          <Button 
            variant="outline" 
            size="icon" 
            onClick={() => loadAnalytics(false)} 
            disabled={isRefreshing}
            aria-label="Refresh data"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>

          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.print()}
            className="hidden md:flex gap-1.5"
          >
            <Download className="h-4 w-4" />
            Audit Report
          </Button>

          <Button 
            variant="outline" 
            size="icon" 
            onClick={() => (window.location.href = "/settings")} 
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>

          {selectedInstallation && (
            <UpgradeModal
              installationId={selectedId}
              currentPanelCount={selectedInstallation.panelSpecs.panelCount}
              onUpgradeComplete={() => loadAnalytics(false)}
            />
          )}
        </div>
      </div>

      {/* Hardware Key Status Banner */}
      {selectedInstallation?.hardwareIntegration.apiKey && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/60 border rounded-lg">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-600 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inverter Gateway:</span>
            <code className="text-xs font-mono bg-background border px-2 py-0.5 rounded">
              {selectedInstallation.hardwareIntegration.apiKey.slice(0, 16)}...
            </code>
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              STREAMING
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-blue-500" />
            Open-Meteo Satellite Sync Active
          </div>
        </div>
      )}

      {/* Diagnostic Alert Banner */}
      <AlertBanner
        faultCategory={currentFault}
        alertMessage={bannerConfig.message}
        alertColor={bannerConfig.color}
        confidence={latestTelemetry?.faultConfidence}
      />

      {/* Automated Action Dispatch Bar */}
      {(currentFault === "SOILING_ALERT" || currentFault === "HARDWARE_FAULT") && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-amber-600" />
                <span className="font-semibold text-sm">Automated O&M Action Recommended</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Current performance deficit is incurring an estimated loss of{" "}
                <span className="font-bold text-amber-600">
                  ₹{analytics?.summary?.totalFinancialLossINR || 0}/day
                </span>. Dispatching maintenance restores peak yield.
              </p>
            </div>
            
            <Button 
              size="sm" 
              onClick={handleDispatchTicket} 
              disabled={isDispatching || dispatchSuccess}
              className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
            >
              {isDispatching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Dispatching...
                </>
              ) : dispatchSuccess ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Ticket Dispatched!
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Dispatch Cleaning Crew
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary KPI Stat Cards */}
      <StatCards
        currentPower={latestTelemetry?.actualPower || 0}
        performanceRatio={latestTelemetry?.performanceRatio || 0}
        satelliteIrradiance={latestTelemetry?.ghi || 0}
        financialLoss={analytics?.summary?.totalFinancialLossINR || 0}
      />

      {/* Live Hardware Simulator Control Panel */}
      

      {/* Primary Analytics Charts */}
      <div className="grid gap-6 grid-cols-1">
        <PowerChart data={analytics?.timeSeriesData || []} />
        <FaultHistoryChart data={analytics?.dailyAggregates || []} />
      </div>

      {/* Client-Friendly System Health Summary */}
      {perfMetrics && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              What&apos;s Happening With Your System
            </CardTitle>
            <CardDescription>
              Simple explanation of your system&apos;s current condition
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <Zap className="h-5 w-5 mx-auto mb-1 text-green-600" />
                <p className="text-lg font-bold">{perfMetrics.totalKwh.toLocaleString()} kWh</p>
                <p className="text-xs text-muted-foreground">Total energy produced</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <Gauge className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                <p className="text-lg font-bold">{perfMetrics.efficiency}%</p>
                <p className="text-xs text-muted-foreground">How efficiently you&apos;re generating</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <Leaf className="h-5 w-5 mx-auto mb-1 text-emerald-600" />
                <p className="text-lg font-bold">{perfMetrics.carbonKg} kg</p>
                <p className="text-xs text-muted-foreground">CO₂ emissions prevented</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-amber-600" />
                <p className="text-lg font-bold">
                  <Badge
                    variant={
                      currentFault === "OPTIMAL"
                        ? "success"
                        : currentFault === "HARDWARE_FAULT"
                        ? "destructive"
                        : "warning"
                    }
                  >
                    {currentFault === "OPTIMAL"
                      ? "Healthy"
                      : currentFault === "WEATHER_AFFECTED"
                      ? "Cloudy Weather"
                      : currentFault === "SOILING_ALERT"
                      ? "Needs Cleaning"
                      : currentFault === "HARDWARE_FAULT"
                      ? "Needs Repair"
                      : "Monitoring"}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">System status in plain English</p>
              </div>
            </div>

            {perfMetrics.diagnoses.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600" /> What We Found
                </h3>
                {perfMetrics.diagnoses.map((insight) => (
                  <div
                    key={insight.category}
                    className={`rounded-lg border p-3 ${
                      insight.severity === "critical"
                        ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                        : insight.severity === "warning"
                        ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
                        : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
                    }`}
                  >
                    <p className="font-medium text-sm">{insight.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                  </div>
                ))}
              </div>
            )}

            {perfMetrics.recommendations.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <ArrowRight className="h-4 w-4 text-blue-600" /> What You Can Do
                </h3>
                {perfMetrics.recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 ${
                      rec.priority === "high"
                        ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                        : rec.priority === "medium"
                        ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
                        : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Badge
                        variant={
                          rec.priority === "high"
                            ? "destructive"
                            : rec.priority === "medium"
                            ? "warning"
                            : "success"
                        }
                        className="text-[10px] mt-0.5 shrink-0"
                      >
                        {rec.priority}
                      </Badge>
                      <div>
                        <p className="font-medium text-sm">{rec.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{rec.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Yield Comparison Chart */}
      {perfMetrics && perfMetrics.yieldData.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Expected vs Actual Output
                </CardTitle>
                <CardDescription>
                  Blue = what panels should produce. Green = what they actually produced.
                </CardDescription>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{perfMetrics.yieldData.length} data points</p>
                <p>
                  {period === "24h" ? "Last 24 hours" : period === "7d" ? "Last 7 days" : period === "30d" ? "Last 30 days" : "Last 90 days"}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={perfMetrics.yieldData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend />
                <Area type="monotone" dataKey="expected" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} name="Should Produce" />
                <Area type="monotone" dataKey="actual" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} name="Actually Produced" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Daily Performance Trend */}
      {perfMetrics && perfMetrics.prTrend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5" />
              Daily Performance Trend
            </CardTitle>
            <CardDescription>
              How your system performance changes day by day. The dashed line at 80% is the minimum healthy level.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={perfMetrics.prTrend}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 1.2]} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: any) => [`${(v * 100).toFixed(0)}%`, "Performance"]} />
                <ReferenceLine y={0.8} stroke="#f59e0b" strokeDasharray="5 5" label="80% Min" />
                <Bar dataKey="pr" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Performance Ratio" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}