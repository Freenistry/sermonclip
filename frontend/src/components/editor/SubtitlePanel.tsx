"use client";

import { useState } from "react";
import { SubtitleStyleSelector, type SubtitleStyle } from "./SubtitleStyleSelector";
import { Type, Sparkles, ToggleLeft, ToggleRight, Download } from "lucide-react";
import type { SubtitleCustomization } from "./types";

interface SubtitlePanelProps {
  subtitleStyle: SubtitleStyle;
  subtitleCustomization: SubtitleCustomization;
  subtitlesEnabled: boolean;
  onStyleChange: (style: SubtitleStyle) => void;
  onCustomizationChange: (customization: SubtitleCustomization) => void;
  onColorChange: (color: string) => void;
  onSubtitlesToggle: (enabled: boolean) => void;
}

type Tab = "styles" | "subtitles" | "effects";

const PRESET_COLORS = [
  "#FFFFFF", "#FFFF00", "#00FFFF", "#00FF00", "#FF0000", "#FFA500",
  "#FF69B4", "#8B5CF6",
];

const FONT_OPTIONS = [
  "Montserrat Bold",
  "Arial",
  "Impact",
  "Comic Sans MS",
];

export function SubtitlePanel({
  subtitleStyle,
  subtitleCustomization,
  subtitlesEnabled,
  onStyleChange,
  onCustomizationChange,
  onColorChange,
  onSubtitlesToggle,
}: SubtitlePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("styles");

  const updateField = <K extends keyof SubtitleCustomization>(
    field: K,
    val: SubtitleCustomization[K]
  ) => {
    onCustomizationChange({ ...subtitleCustomization, [field]: val });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "styles", label: "Styles" },
    { id: "subtitles", label: "Subtitles" },
    { id: "effects", label: "Text Effects" },
  ];

  return (
    <div className="space-y-3">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Type className="w-4 h-4" />
          Subtitles
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSubtitlesToggle(!subtitlesEnabled)}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{ backgroundColor: subtitlesEnabled ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: subtitlesEnabled ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 pb-2 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {!subtitlesEnabled ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          Enable subtitles to customize styles and effects
        </p>
      ) : (
        <>
          {activeTab === "styles" && (
            <SubtitleStyleSelector
              value={subtitleStyle}
              effectColor={subtitleCustomization.color}
              onStyleChange={onStyleChange}
              onColorChange={onColorChange}
            />
          )}

          {activeTab === "subtitles" && (
            <div className="space-y-4">
              {/* Font family */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Font
                </label>
                <div className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-medium">
                  Montserrat-Bold
                </div>
              </div>

              {/* Font size */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Size
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateField("fontSize", Math.max(24, subtitleCustomization.fontSize - 4))}
                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-border hover:bg-muted text-base transition-colors"
                  >
                    -
                  </button>
                  <div className="flex-1 text-center text-sm font-medium tabular-nums">
                    {subtitleCustomization.fontSize}px
                  </div>
                  <button
                    onClick={() => updateField("fontSize", Math.min(72, subtitleCustomization.fontSize + 4))}
                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-border hover:bg-muted text-base transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Font color */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateField("color", c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        subtitleCustomization.color === c
                          ? "border-primary scale-110"
                          : "border-zinc-600 hover:border-zinc-400"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <label className="w-7 h-7 rounded-full border-2 border-zinc-600 hover:border-zinc-400 cursor-pointer overflow-hidden relative">
                    <input
                      type="color"
                      value={subtitleCustomization.color}
                      onChange={(e) => updateField("color", e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div
                      className="w-full h-full"
                      style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
                    />
                  </label>
                </div>
              </div>

              {/* Bold / Uppercase toggles */}
              <div className="flex gap-2">
                <button
                  onClick={() => updateField("fontWeight", subtitleCustomization.fontWeight === "bold" ? "normal" : "bold")}
                  className={`flex-1 h-9 flex items-center justify-center rounded-lg border text-sm font-bold transition-colors ${
                    subtitleCustomization.fontWeight === "bold"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  B
                </button>
                <button
                  onClick={() => updateField("uppercase", !subtitleCustomization.uppercase)}
                  className={`flex-1 h-9 flex items-center justify-center rounded-lg border text-sm transition-colors ${
                    subtitleCustomization.uppercase
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  aA
                </button>
              </div>
            </div>
          )}

          {activeTab === "effects" && (
            <div className="space-y-4">
              {/* Effect color */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Effect Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => onColorChange(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        subtitleCustomization.color === c
                          ? "border-primary scale-110"
                          : "border-zinc-600 hover:border-zinc-400"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <label className="w-7 h-7 rounded-full border-2 border-zinc-600 hover:border-zinc-400 cursor-pointer overflow-hidden relative">
                    <input
                      type="color"
                      value={subtitleCustomization.color}
                      onChange={(e) => onColorChange(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div
                      className="w-full h-full"
                      style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
                    />
                  </label>
                </div>
              </div>

              {/* Active style info */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Active Effect
                </label>
                <div className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm capitalize">
                  {subtitleStyle.replace(/_/g, " ")}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {getEffectDescription(subtitleStyle)}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getEffectDescription(style: SubtitleStyle): string {
  const descriptions: Record<SubtitleStyle, string> = {
    basic: "Standard subtitles at the bottom of the screen",
    one_word: "One large word at a time, centered",
    two_word: "Two words at a time, centered",
    elevate: "Words pop in with a scale animation",
    word_color: "Active word changes to the effect color",
    text_reveal: "Words progressively revealed with underline",
    slide_in: "Phrases slide in from the left",
    word_bg: "Active word gets a colored background",
    word_append: "Words appear one by one, building up",
    highlight_impactful: "Longer words highlighted when spoken",
  };
  return descriptions[style];
}
