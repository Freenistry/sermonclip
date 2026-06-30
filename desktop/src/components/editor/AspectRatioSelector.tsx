export type AspectRatio = "9:16" | "16:9" | "1:1";

const RATIOS: { value: AspectRatio; label: string; w: number; h: number }[] = [
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
];

interface AspectRatioSelectorProps {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
}

export function AspectRatioSelector({ value, onChange }: AspectRatioSelectorProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Aspect Ratio</h3>
      <div className="flex gap-3">
        {RATIOS.map((ratio) => {
          const maxDim = 48;
          const scale = maxDim / Math.max(ratio.w, ratio.h);
          const boxW = Math.round(ratio.w * scale);
          const boxH = Math.round(ratio.h * scale);

          return (
            <button
              key={ratio.value}
              onClick={() => onChange(ratio.value)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors ${
                value === ratio.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div
                className={`border-2 rounded-sm ${
                  value === ratio.value ? "border-primary" : "border-muted-foreground/40"
                }`}
                style={{ width: boxW, height: boxH }}
              />
              <span className="text-xs font-medium">{ratio.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
