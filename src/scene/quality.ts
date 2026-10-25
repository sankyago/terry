import type { QualitySetting } from '../storage/storage';

export interface QualityProfile {
  level: 'low' | 'high';
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export function resolveQuality(setting: QualitySetting): QualityProfile {
  const level = setting === 'auto' ? (isTouchDevice() ? 'low' : 'high') : setting;
  return level === 'low'
    ? { level, maxPixelRatio: 1.25, antialias: false, shadows: false }
    : { level, maxPixelRatio: 2, antialias: true, shadows: true };
}
