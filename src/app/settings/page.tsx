"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, CreditCard, Webhook, Users, ArrowUpRight, Key, SlidersHorizontal } from "lucide-react";
import ApiKeyManagementTab from "@/components/dashboard/ApiKeyManagementTab";
import InstallationSettingsTab from "@/components/dashboard/InstallationSettingsTab";

interface Installation {
  id: string;
  systemName: string;
  hasApiKey: boolean;
  lastTelemetryAt?: string;
}

interface InstallationDetail {
  id: string;
  systemName: string;
  location: { latitude: number; longitude: number; address: string; city: string };
  panelSpecs: {
    totalCapacityKw: number;
    panelCount: number;
    individualPanelWattage: number;
    totalAreaSqMeters: number;
    panelEfficiencyPercentage: number;
    tiltAngle: number;
    azimuthAngle: number;
  };
  inverterSpecs: { brand: string; maxCapacityKw: number; efficiency: number };
  hardwareIntegration: {
    hasPhysicalIrradianceSensor: boolean;
    sensorDeviceId?: string;
    hasApiKey: boolean;
    lastTelemetryAt?: string;
  };
}

interface OrgData {
  organization: {
    id: string;
    name: string;
    subscriptionPlan: string;
    billingStatus: string;
    limits: {
      maxInstallations: number;
      maxTelemetryRetentionDays: number;
      maxSeats: number;
    };
  };
  stats: {
    installationCount: number;
    userCount: number;
  };
  webhook: {
    configured: boolean;
    url?: string;
  };
  installations: Installation[];
}

const PLAN_FEATURES = {
  FREE: {
    price: "Free",
    arrays: "3 arrays",
    retention: "30 days data",
    seats: "1 user",
    support: "Community",
  },
  PRO: {
    price: "$29/mo",
    arrays: "50 arrays",
    retention: "1 year data",
    seats: "10 users",
    support: "Email (24h)",
  },
  ENTERPRISE: {
    price: "$199/mo",
    arrays: "Unlimited",
    retention: "2 years data",
    seats: "Unlimited",
    support: "Priority (4h)",
  },
};

export default function SettingsPage() {
  const [orgData, setOrgData] = useState<OrgData | null>(null);
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>("");
  const [installationDetail, setInstallationDetail] = useState<InstallationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const installationsRes = await fetch("/api/v1/installations");
        const installationsData = await installationsRes.json();
        const installations = (installationsData.installations || []).map((inst: any) => ({
          id: inst.id || inst._id,
          systemName: inst.systemName,
          hasApiKey: inst.hardwareIntegration?.hasApiKey ?? !!inst.hardwareIntegration?.apiKeyHash,
          lastTelemetryAt: inst.hardwareIntegration?.lastTelemetryAt,
        }));

        setOrgData({
          organization: {
            id: "",
            name: "My Organization",
            subscriptionPlan: "FREE",
            billingStatus: "TRIAL",
            limits: {
              maxInstallations: 3,
              maxTelemetryRetentionDays: 30,
              maxSeats: 1,
            },
          },
          stats: {
            installationCount: installationsData.pagination?.total || installations.length,
            userCount: 1,
          },
          webhook: { configured: false },
          installations,
        });

        if (installations.length > 0) {
          setSelectedInstallationId(installations[0].id);
        }
      } catch {
        // Silent
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  // Fetch full installation detail when selected changes
  useEffect(() => {
    if (!selectedInstallationId) {
      setInstallationDetail(null);
      return;
    }

    async function loadDetail() {
      setIsLoadingDetail(true);
      try {
        const res = await fetch(`/api/v1/installations/${selectedInstallationId}`);
        const data = await res.json();
        setInstallationDetail(data);
      } catch {
        setInstallationDetail(null);
      } finally {
        setIsLoadingDetail(false);
      }
    }
    loadDetail();
  }, [selectedInstallationId]);

  const refreshInstallations = useCallback(async () => {
    try {
      const installationsRes = await fetch("/api/v1/installations");
      const installationsData = await installationsRes.json();
      const installations = (installationsData.installations || []).map((inst: any) => ({
        id: inst.id || inst._id,
        systemName: inst.systemName,
        hasApiKey: inst.hardwareIntegration?.hasApiKey ?? !!inst.hardwareIntegration?.apiKeyHash,
        lastTelemetryAt: inst.hardwareIntegration?.lastTelemetryAt,
      }));
      setOrgData((prev) => (prev ? { ...prev, installations } : prev));
    } catch {
      // Silent
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading settings...
      </div>
    );
  }

  if (!orgData) return null;

  const plan =
    PLAN_FEATURES[orgData.organization.subscriptionPlan as keyof typeof PLAN_FEATURES] ||
    PLAN_FEATURES.FREE;
  const usagePercent =
    (orgData.stats.installationCount / orgData.organization.limits.maxInstallations) * 100;

  const selectedInstallation = orgData.installations.find(
    (i) => i.id === selectedInstallationId
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Tabs defaultValue="billing">
        <TabsList>
          <TabsTrigger value="billing" className="gap-1">
            <CreditCard className="h-4 w-4" /> Billing
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="gap-1">
            <Key className="h-4 w-4" /> API Keys
          </TabsTrigger>
          <TabsTrigger value="installation" className="gap-1">
            <SlidersHorizontal className="h-4 w-4" /> Installation
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-1">
            <Webhook className="h-4 w-4" /> Webhooks
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-1">
            <Users className="h-4 w-4" /> Team
          </TabsTrigger>
        </TabsList>

        <TabsContent value="billing" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Current Plan</CardTitle>
                <Badge
                  variant={
                    orgData.organization.subscriptionPlan === "FREE" ? "secondary" : "default"
                  }
                >
                  {orgData.organization.subscriptionPlan}
                </Badge>
              </div>
              <CardDescription>
                {orgData.organization.billingStatus === "TRIAL"
                  ? "You are on a free trial"
                  : `Status: ${orgData.organization.billingStatus}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Arrays</p>
                  <p className="font-medium">
                    {orgData.stats.installationCount} /{" "}
                    {orgData.organization.limits.maxInstallations}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Data Retention</p>
                  <p className="font-medium">
                    {orgData.organization.limits.maxTelemetryRetentionDays} days
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Team Seats</p>
                  <p className="font-medium">
                    {orgData.stats.userCount} / {orgData.organization.limits.maxSeats}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Price</p>
                  <p className="font-medium">{plan.price}</p>
                </div>
              </div>
              {usagePercent > 80 && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  You are at {usagePercent.toFixed(0)}% of your array limit. Upgrade to add more
                  installations.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-3 gap-4">
            {(Object.entries(PLAN_FEATURES) as [string, typeof plan][]).map(([key, features]) => (
              <Card
                key={key}
                className={key === orgData.organization.subscriptionPlan ? "border-primary" : ""}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{key}</CardTitle>
                  <p className="text-2xl font-bold">{features.price}</p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{features.arrays}</p>
                  <p>{features.retention}</p>
                  <p>{features.seats}</p>
                  <p>{features.support} support</p>
                  {key !== orgData.organization.subscriptionPlan && (
                    <Button variant="outline" className="w-full mt-4" disabled={key === "FREE"}>
                      {key === "FREE" ? "Current" : "Upgrade"}{" "}
                      <ArrowUpRight className="h-4 w-4 ml-1" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-4">
          {orgData.installations.length > 0 ? (
            <>
              {orgData.installations.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Select Array</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {orgData.installations.map((inst) => (
                        <Button
                          key={inst.id}
                          variant={inst.id === selectedInstallationId ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedInstallationId(inst.id)}
                        >
                          {inst.systemName}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedInstallation && (
                <ApiKeyManagementTab
                  installationId={selectedInstallation.id}
                  systemName={selectedInstallation.systemName}
                  hasApiKey={selectedInstallation.hasApiKey}
                  lastTelemetryAt={selectedInstallation.lastTelemetryAt}
                />
              )}
            </>
          ) : (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground">
                <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No installations found</p>
                <p className="text-xs mt-1">Create an installation to generate an API key</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="installation" className="space-y-4">
          {orgData.installations.length > 0 ? (
            <>
              {orgData.installations.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Select Array</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {orgData.installations.map((inst) => (
                        <Button
                          key={inst.id}
                          variant={inst.id === selectedInstallationId ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedInstallationId(inst.id)}
                        >
                          {inst.systemName}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {isLoadingDetail ? (
                <Card>
                  <CardContent className="flex items-center justify-center h-32 text-muted-foreground">
                    Loading installation details...
                  </CardContent>
                </Card>
              ) : installationDetail ? (
                <InstallationSettingsTab
                  installation={installationDetail}
                  onSaved={refreshInstallations}
                />
              ) : (
                <Card>
                  <CardContent className="text-center py-8 text-muted-foreground">
                    No installation selected
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground">
                <SlidersHorizontal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No installations found</p>
                <p className="text-xs mt-1">Create an installation to edit its settings</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <CardTitle>Webhook Configuration</CardTitle>
              <CardDescription>
                Receive fault alerts (YELLOW/RED) via HTTP POST to your endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {orgData.webhook.configured ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Registered URL:</p>
                  <code className="block p-2 bg-muted rounded text-sm">
                    {orgData.webhook.url}
                  </code>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Webhook className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No webhook configured</p>
                  <p className="text-xs mt-1">Register via POST /api/v1/webhooks</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage who has access to your solar installations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Team management coming in v2</p>
                <p className="text-xs mt-1">
                  Currently limited to {orgData.organization.limits.maxSeats} seat(s)
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
