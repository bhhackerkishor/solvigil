"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle,
  Info,
  XCircle,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";

interface AlertBannerProps {
  faultCategory: string;
  alertMessage: string;
  alertColor: "green" | "blue" | "yellow" | "red" | "gray";
  confidence?: number;
}

const colorConfig = {
  green: {
    bg: "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800",
    text: "text-green-800 dark:text-green-200",
    icon: CheckCircle,
    iconColor: "text-green-600",
  },
  blue: {
    bg: "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800",
    text: "text-blue-800 dark:text-blue-200",
    icon: Info,
    iconColor: "text-blue-600",
  },
  yellow: {
    bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800",
    text: "text-yellow-800 dark:text-yellow-200",
    icon: AlertTriangle,
    iconColor: "text-yellow-600",
  },
  red: {
    bg: "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800",
    text: "text-red-800 dark:text-red-200",
    icon: XCircle,
    iconColor: "text-red-600",
  },
  gray: {
    bg: "bg-gray-50 border-gray-200 dark:bg-gray-950 dark:border-gray-800",
    text: "text-gray-800 dark:text-gray-200",
    icon: HelpCircle,
    iconColor: "text-gray-600",
  },
};

export default function AlertBanner({
  faultCategory,
  alertMessage,
  alertColor,
  confidence,
}: AlertBannerProps) {
  const config = colorConfig[alertColor] || colorConfig.gray;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border",
        config.bg
      )}
      role="alert"
      aria-live="polite"
    >
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", config.iconColor)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn("font-semibold text-sm", config.text)}>
            {faultCategory.replace(/_/g, " ")}
          </p>
          {confidence !== undefined && (
            <span className={cn("text-xs opacity-70", config.text)}>
              ({(confidence * 100).toFixed(0)}% confidence)
            </span>
          )}
        </div>
        <p className={cn("text-sm mt-0.5", config.text)}>{alertMessage}</p>
      </div>
    </div>
  );
}
