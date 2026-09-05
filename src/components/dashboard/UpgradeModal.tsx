"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";

interface UpgradeModalProps {
  installationId: string;
  currentPanelCount: number;
  onUpgradeComplete: () => void;
}

export default function UpgradeModal({
  installationId,
  currentPanelCount,
  onUpgradeComplete,
}: UpgradeModalProps) {
  const [open, setOpen] = useState(false);
  const [panelCountDelta, setPanelCountDelta] = useState(2);
  const [newPanelWattage, setNewPanelWattage] = useState(500);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleUpgrade = async () => {
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch(`/api/installations/${installationId}/upgrade`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panelCountDelta,
          individualPanelWattage: newPanelWattage,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setOpen(false);
      onUpgradeComplete();
    } catch (err: any) {
      setError(err.message || "Upgrade failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" /> Extend Array
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upgrade Solar Array</DialogTitle>
          <DialogDescription>
            Add more panels to your installation. The baseline performance will be
            automatically recalculated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 bg-muted rounded-lg text-sm">
            Current panels: <strong>{currentPanelCount}</strong>
          </div>
          <div className="space-y-2">
            <Label>Additional Panels</Label>
            <Input
              type="number"
              min={1}
              value={panelCountDelta}
              onChange={(e) => setPanelCountDelta(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>New Panel Wattage (W)</Label>
            <Input
              type="number"
              value={newPanelWattage}
              onChange={(e) => setNewPanelWattage(parseInt(e.target.value) || 0)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            New total: {currentPanelCount + panelCountDelta} panels /{" "}
            {((currentPanelCount + panelCountDelta) * newPanelWattage) / 1000} kW
          </p>
        </div>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleUpgrade} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Apply Upgrade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
