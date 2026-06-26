"use client";

import { useEffect, useRef, useState } from "react";

export type SubtitleStyle = "basic" | "one_word" | "two_word" | "elevate" | "word_color";

const STYLES: { value: SubtitleStyle; label: string }[] = [
  { value: "elevate", label: "Elevate" },
  { value: "word_color", label: "Word Color Change" },
  { value: "one_word", label: "One Word" },
  { value: "basic", label: "Basic Subtitles" },
  { value: "two_word", label: "Two Word" },
];

const PRESET_COLORS = [
  "#FFFFFF", "#FFFF00", "#00FFFF", "#00FF00", "#FF0000", "#FFA500",
  "#FF69B4", "#8B5CF6",
];

function BasicPreview() {
  return (
    <div className="flex items-center justify-center h-full px-2">
      <span className="text-white text-sm font-bold drop-shadow-md">
        Basic subtitles
      </span>
    </div>
  );
}

function OneWordPreview() {
  const words = ["GO", "BIG", "NOW"];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % words.length), 800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center justify-center h-full">
      <span className="text-white text-2xl font-bold drop-shadow-md transition-all duration-200">
        {words[idx]}
      </span>
    </div>
  );
}

function TwoWordPreview() {
  const pairs = [["show", "two"], ["words", "here"]];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % pairs.length), 1200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center justify-center h-full">
      <span className="text-white text-base font-bold drop-shadow-md">
        {pairs[idx][0]} {pairs[idx][1]}
      </span>
    </div>
  );
}

function ElevatePreview({ color }: { color: string }) {
  const words = ["ELEVATE", "THE", "WORDS"];
  const [idx, setIdx] = useState(0);
  const [scale, setScale] = useState(1.0);
  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((i) => (i + 1) % words.length);
      setScale(0.8);
      setTimeout(() => setScale(1.1), 100);
      setTimeout(() => setScale(1.0), 250);
    }, 800);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex items-center justify-center h-full px-2 text-center">
      <span className="text-sm font-bold drop-shadow-md leading-tight">
        {words.map((w, i) => (
          <span
            key={w}
            className="transition-transform duration-150 inline-block mx-[2px]"
            style={{
              color: i === idx ? color : "#FFFFFF",
              transform: i === idx ? `scale(${scale})` : "scale(1)",
              fontWeight: i === idx ? 900 : 700,
            }}
          >
            {w}
          </span>
        ))}
      </span>
    </div>
  );
}

function WordColorPreview({ color }: { color: string }) {
  const words = ["Highlight", "the", "words"];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % words.length), 700);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center justify-center h-full px-2">
      <span className="text-sm font-bold drop-shadow-md">
        {words.map((w, i) => (
          <span
            key={i}
            className="transition-colors duration-200"
            style={{ color: i === active ? color : "#FFFFFF" }}
          >
            {w}{" "}
          </span>
        ))}
      </span>
    </div>
  );
}

interface SubtitleStyleSelectorProps {
  value: SubtitleStyle;
  effectColor: string;
  onStyleChange: (style: SubtitleStyle) => void;
  onColorChange: (color: string) => void;
}

export function SubtitleStyleSelector({
  value,
  effectColor,
  onStyleChange,
  onColorChange,
}: SubtitleStyleSelectorProps) {
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

  const renderPreview = (style: SubtitleStyle) => {
    switch (style) {
      case "basic": return <BasicPreview />;
      case "one_word": return <OneWordPreview />;
      case "two_word": return <TwoWordPreview />;
      case "elevate": return <ElevatePreview color={effectColor} />;
      case "word_color": return <WordColorPreview color={effectColor} />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Change Effect Color — quso.ai style row */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowColorPicker((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors"
        >
          <span className="text-sm font-medium">Change Effect Color</span>
          <div
            className="w-6 h-6 rounded-full border-2 border-zinc-500 shrink-0"
            style={{ backgroundColor: effectColor }}
          />
        </button>

        {showColorPicker && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg p-3 shadow-xl">
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { onColorChange(c); setShowColorPicker(false); }}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    effectColor === c
                      ? "border-primary scale-110"
                      : "border-zinc-600 hover:border-zinc-400"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label className="w-7 h-7 rounded-full border-2 border-zinc-600 hover:border-zinc-400 cursor-pointer overflow-hidden relative">
                <input
                  type="color"
                  value={effectColor}
                  onChange={(e) => { onColorChange(e.target.value); }}
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

      {/* Style preview cards — 2-col grid */}
      <div className="grid grid-cols-2 gap-2">
        {STYLES.map((style) => (
          <button
            key={style.value}
            onClick={() => onStyleChange(style.value)}
            className={`flex flex-col rounded-lg border-2 transition-colors overflow-hidden ${
              value === style.value
                ? "border-primary"
                : "border-zinc-800 hover:border-zinc-600"
            }`}
          >
            <div className="bg-zinc-900 h-[110px] w-full">
              {renderPreview(style.value)}
            </div>
            <div className="text-[11px] text-left px-1.5 py-1.5 text-muted-foreground font-medium leading-tight">
              {style.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
