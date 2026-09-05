"use client";

import React from "react";
import OnboardingWizard from "@/components/onboard/OnboardingWizard";

export default function OnboardPage() {
  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">Register Your Solar Array</h1>
        <p className="text-muted-foreground mt-2">
          Complete the wizard below to start monitoring your solar installation with SolVigil.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
