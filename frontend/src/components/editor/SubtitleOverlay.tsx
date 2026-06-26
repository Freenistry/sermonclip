"use client";

import { useMemo } from "react";
import type { SubtitleStyle } from "./SubtitleStyleSelector";
import type { WordTimestamp } from "./types";

interface SubtitleOverlayProps {
  words: WordTimestamp[];
  currentTime: number;
  style: SubtitleStyle;
}

function groupIntoPhrasesOf(words: WordTimestamp[], size: number): WordTimestamp[][] {
  const phrases: WordTimestamp[][] = [];
  for (let i = 0; i < words.length; i += size) {
    phrases.push(words.slice(i, i + size));
  }
  return phrases;
}

export function SubtitleOverlay({ words, currentTime, style }: SubtitleOverlayProps) {
  const phrases = useMemo(() => groupIntoPhrasesOf(words, 8), [words]);
  const pairs = useMemo(() => groupIntoPhrasesOf(words, 2), [words]);

  if (style === "basic") {
    const activePhrase = phrases.find(
      (p) => currentTime >= p[0].start && currentTime <= p[p.length - 1].end
    );
    if (!activePhrase) return null;
    return (
      <div className="absolute bottom-[10%] left-0 right-0 text-center px-4">
        <span className="text-white text-lg font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          {activePhrase.map((w) => w.word).join(" ")}
        </span>
      </div>
    );
  }

  if (style === "one_word") {
    const activeWord = words.find((w) => currentTime >= w.start && currentTime <= w.end);
    if (!activeWord) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-3xl font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          {activeWord.word}
        </span>
      </div>
    );
  }

  if (style === "two_word") {
    const activePair = pairs.find(
      (p) => currentTime >= p[0].start && currentTime <= p[p.length - 1].end
    );
    if (!activePair) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-2xl font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          {activePair.map((w) => w.word).join(" ")}
        </span>
      </div>
    );
  }

  if (style === "elevate") {
    const activeWord = words.find((w) => currentTime >= w.start && currentTime <= w.end);
    if (!activeWord) return null;
    const progress = (currentTime - activeWord.start) / (activeWord.end - activeWord.start);
    const scale = progress < 0.3 ? 0.8 + (progress / 0.3) * 0.3 : progress < 0.5 ? 1.1 - ((progress - 0.3) / 0.2) * 0.1 : 1;
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-white text-3xl font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] transition-transform"
          style={{ transform: `scale(${scale})` }}
        >
          {activeWord.word}
        </span>
      </div>
    );
  }

  if (style === "word_color") {
    const activePhrase = phrases.find(
      (p) => currentTime >= p[0].start && currentTime <= p[p.length - 1].end
    );
    if (!activePhrase) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <span className="text-lg font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          {activePhrase.map((w, i) => (
            <span
              key={i}
              className={
                currentTime >= w.start && currentTime <= w.end
                  ? "text-yellow-400"
                  : "text-white"
              }
            >
              {w.word}{" "}
            </span>
          ))}
        </span>
      </div>
    );
  }

  return null;
}
