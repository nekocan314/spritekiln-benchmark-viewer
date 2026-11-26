export type Direction = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';
export type RenderMode = 'color' | 'normal' | 'emissive' | 'lit';
export type BgTheme = 'dark' | 'mid' | 'light';

export interface PresetConfig {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  isHairCompare?: boolean;
}

export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AsepriteFrameEntry {
  frame: SpriteRect;
  duration: number;
}

export interface SpriteKilnDirAnim {
  row: number;
  frames: string[];
  durations: number[];
  events?: Record<string, string[]>;
  sockets?: Record<string, ([number, number, number] | null)[]>;
}

export interface SpriteKilnAnimEntry {
  loop: boolean;
  directions: Record<Direction, SpriteKilnDirAnim>;
}

export interface SpriteKilnAtlasJson {
  frames: Record<string, AsepriteFrameEntry>;
  spritekiln: {
    name: string;
    frame_size: number;
    pivot: { x: number; y: number };
    directions: Direction[];
    normal_map: string;
    emissive_map: string;
    animations: Record<string, SpriteKilnAnimEntry>;
  };
}

export interface LoadedPreset {
  config: PresetConfig;
  json: SpriteKilnAtlasJson;
  colorImg: HTMLImageElement;
  normalImg: HTMLImageElement;
  emissiveImg: HTMLImageElement;
}
