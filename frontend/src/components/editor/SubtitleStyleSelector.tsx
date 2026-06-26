"use client";

import { Card } from "@/components/ui/card";

export type SubtitleStyle = "basic" | "one_word" | "two_word" | "elevate" | "word_color";

const STYLES: { value: SubtitleStyle; label: string; description: string }[] = [
  { value: "basic", label: "Basic", description: "Full phrases at bottom" },
  { value: "one_word", label: "One Word", description: "Single word, large center" },
  { value: "two_word", label: "Two Words", description: "Word pairs, centered" },
  { value: "elevate", label: "Elevate", description: "Pop-in animation per word" },
  { value: "word_color", label: "Highlight", description: "Active word highlighted" },
];

interface SubtitleStyleSelectorProps {
  value: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}

export function SubtitleStyleSelector({ value, onChange }: SubtitleStyleSelectorProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Subtitle Style</h3>
      <div className="space-y-1.5">
        {STYLES.map((style) => (
          <button
            key={style.value}
            onClick={() => onChange(style.value)}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              value === style.value
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/30"
            }`}
          >
            <div className="font-medium text-sm">{style.label}</div>
            <div className="text-xs text-muted-foreground">{style.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
