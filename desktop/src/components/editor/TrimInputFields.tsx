import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TrimInputFieldsProps {
  trimStart: number;
  trimEnd: number;
  onChange: (start: number, end: number) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function parseTime(value: string): number | null {
  const match = value.match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

export function TrimInputFields({ trimStart, trimEnd, onChange }: TrimInputFieldsProps) {
  const duration = trimEnd - trimStart;

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseTime(e.target.value);
    if (parsed !== null && parsed < trimEnd - 10) {
      onChange(parsed, trimEnd);
    }
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseTime(e.target.value);
    if (parsed !== null && parsed > trimStart + 10) {
      onChange(trimStart, parsed);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Trim</h3>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Start</Label>
          <Input
            key={`start-${trimStart}`}
            defaultValue={formatTime(trimStart)}
            onBlur={handleStartChange}
            className="text-sm"
            placeholder="0:00"
          />
        </div>
        <div>
          <Label className="text-xs">End</Label>
          <Input
            key={`end-${trimEnd}`}
            defaultValue={formatTime(trimEnd)}
            onBlur={handleEndChange}
            className="text-sm"
            placeholder="1:00"
          />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Duration: {formatTime(duration)}
      </div>
    </div>
  );
}
