"use client";

import { useEffect, useRef, useState } from "react";
import type { SubtitleCustomization } from "./types";

const PRESET_COLORS = [
  "#FFFFFF", "#FFFF00", "#00FFFF", "#00FF00", "#FF0000", "#FFA500",
  "#FF69B4", "#8B5CF6",
];

interface SubtitleCustomizerProps {
  value: SubtitleCustomization;
  onChange: (customization: SubtitleCustomization) => void;
}

export function SubtitleCustomizer({ value, onChange }: SubtitleCustomizerProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    }
    if (showColorPicker) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showColorPicker]);

  const updateField = <K extends keyof SubtitleCustomization>(
    field: K,
    val: SubtitleCustomization[K]
  ) => {
    onChange({ ...value, [field]: val });
  };

  const btnBase =
    "h-9 px-2.5 flex items-center justify-center text-sm transition-colors hover:bg-muted rounded cursor-pointer";
  const btnActive = "bg-muted font-semibold";

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-background">
      {/* Font name (read-only) */}
      <div className="flex items-center gap-1.5 pr-3 border-r border-border mr-1">
        <span className="text-sm font-medium whitespace-nowrap">Montserrat-Bold</span>
      </div>

      {/* Font size: - / number / + */}
      <div className="flex items-center border-r border-border pr-3 mr-1">
        <button
          onClick={() => updateField("fontSize", Math.max(24, value.fontSize - 4))}
          className="h-9 w-8 flex items-center justify-center text-base hover:bg-muted rounded transition-colors"
        >
          -
        </button>
        <span className="text-sm font-medium w-8 text-center tabular-nums select-none">
          {value.fontSize}
        </span>
        <button
          onClick={() => updateField("fontSize", Math.min(72, value.fontSize + 4))}
          className="h-9 w-8 flex items-center justify-center text-base hover:bg-muted rounded transition-colors"
        >
          +
        </button>
      </div>

      {/* Text style buttons */}
      <div className="flex items-center gap-0.5 border-r border-border pr-3 mr-1">
        {/* Font color */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowColorPicker((v) => !v)}
            className={`${btnBase} flex-col gap-0 text-lg font-serif`}
            title="Font color"
          >
            <span style={{ color: value.color }}>A</span>
            <span
              className="block h-[3px] w-4 rounded-full -mt-1"
              style={{ backgroundColor: value.color }}
            />
          </button>
          {showColorPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg p-3 shadow-xl">
              <div className="flex items-center gap-2 flex-wrap w-[200px]">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { updateField("color", c); setShowColorPicker(false); }}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      value.color === c
                        ? "border-primary scale-110"
                        : "border-zinc-600 hover:border-zinc-400"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <label className="w-7 h-7 rounded-full border-2 border-zinc-600 hover:border-zinc-400 cursor-pointer overflow-hidden relative">
                  <input
                    type="color"
                    value={value.color}
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
          )}
        </div>

        {/* Bold */}
        <button
          onClick={() =>
            updateField("fontWeight", value.fontWeight === "bold" ? "normal" : "bold")
          }
          className={`${btnBase} font-bold text-base ${
            value.fontWeight === "bold" ? btnActive : ""
          }`}
          title="Bold"
        >
          B
        </button>

        {/* Uppercase toggle */}
        <button
          onClick={() => updateField("uppercase", !value.uppercase)}
          className={`${btnBase} text-sm tracking-tight ${
            value.uppercase ? btnActive : ""
          }`}
          title="Uppercase"
        >
          aA
        </button>
      </div>

      {/* Alignment (center only — visual indicator) */}
      <div className="flex items-center gap-0.5 pr-3 mr-1">
        <button className={`${btnBase} ${btnActive}`} title="Align center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="3" x2="14" y2="3" />
            <line x1="4" y1="6.5" x2="12" y2="6.5" />
            <line x1="2" y1="10" x2="14" y2="10" />
            <line x1="4" y1="13" x2="12" y2="13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
