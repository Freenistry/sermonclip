export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleCustomization {
  color: string;       // hex color, default "#FFFFFF"
  fontSize: number;    // px, default 48
  fontWeight: "normal" | "bold";
  uppercase: boolean;  // text-transform: uppercase
}
