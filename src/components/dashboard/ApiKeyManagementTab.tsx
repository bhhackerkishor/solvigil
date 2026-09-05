"use client";

import React, { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Key, Copy, Check, AlertTriangle, Eye, EyeOff } from "lucide-react";

interface ApiKeyManagementTabProps {
  installationId: string;
  systemName: string;
  hasApiKey: boolean;
  lastTelemetryAt?: string;
}

export default function ApiKeyManagementTab({
  installationId,
  systemName,
  hasApiKey: initialHasApiKey,
  lastTelemetryAt,
}: ApiKeyManagementTabProps) {
  const [hasApiKey, setHasApiKey] = useState(initialHasApiKey);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleRegenerate = useCallback(async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch(`/api/v1/installations/${installationId}/regenerate-api-key`, {
        method: "PATCH",
      });
      const data = await res.json();
      if (res.ok) {
        setNewApiKey(data.apiKey);
        setHasApiKey(true); // Key now exists
        setShowKey(true);
      }
    } catch {
      // Error handled silently
    } finally {
      setIsRegenerating(false);
    }
  }, [installationId]);

  const copyToClipboard = useCallback(async () => {
    if (!newApiKey) return;
    try {
      await navigator.clipboard.writeText(newApiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = newApiKey;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [newApiKey]);

  const isRecentlyActive = lastTelemetryAt
    ? Date.now() - new Date(lastTelemetryAt).getTime() < 5 * 60 * 1000
    : false;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Key & Integration
              </CardTitle>
              <CardDescription>
                Manage the hardware integration key for {systemName}
              </CardDescription>
            </div>
            <Badge variant={hasApiKey ? (isRecentlyActive ? "success" : "default") : "destructive"}>
              {hasApiKey ? (isRecentlyActive ? "Active" : "Configured") : "No Key"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Masked key display */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Current API Key</p>
                <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
                  {hasApiKey ? (
                    <>
                      <span className="tracking-wider">sv_••••••••••••••••</span>
                      <Badge variant="outline" className="text-xs">
                        SHA-256 Hashed
                      </Badge>
                    </>
                  ) : (
                    <span className="text-destructive">No API key configured</span>
                  )}
                </div>
              </div>
              {hasApiKey && (
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
            </div>
            {lastTelemetryAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Last telemetry: {new Date(lastTelemetryAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Newly generated key display */}
          {newApiKey && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                    New API Key Generated
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Copy this token immediately. For your security, it will never be displayed again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-white px-3 py-2 text-sm font-mono break-all border dark:bg-black">
                      {showKey ? newApiKey : "••••••••••••••••••••••••••••••••"}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyToClipboard}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Regenerate button */}
          <div className="flex justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isRegenerating}>
                  {isRegenerating ? "Regenerating..." : "Regenerate API Key"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <p>
                      This will <strong>immediately invalidate</strong> the current API key for{" "}
                      <strong>{systemName}</strong>.
                    </p>
                    <p className="text-destructive font-medium">
                      Any devices, scripts, or integrations using the old key will fail instantly
                      and require manual reconfiguration.
                    </p>
                    <p>This action cannot be undone.</p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRegenerate}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, Regenerate Key
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
