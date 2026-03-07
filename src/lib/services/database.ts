// =============================================================================
// GMTW Trail Map — Dexie.js Datenbank-Schema (IndexedDB)
// =============================================================================

import Dexie, { type Table } from 'dexie';
import type {
  Project,
  GmtwTrack,
  RunRecord,
  CustomMarker,
  TrackFeature,
  TrackEdit,
  TrackCondition,
  LocsOverride
} from '$lib/types';

/** Track-Metadaten (Bewertungen, Features, Änderungshistorie, Beschreibung, Zustand) */
export interface TrackMeta {
  trackId: string;
  rating?: number;              // 0–5 Sterne
  features: TrackFeature[];
  edits: TrackEdit[];
  description?: string;         // Freitext-Beschreibung, max 400 Zeichen
  condition?: TrackCondition;   // Aktueller Streckenzustand
}

/** GMTW Datenbank — relationale IndexedDB via Dexie.js */
export class GMTWDatabase extends Dexie {
  projects!: Table<Project, string>;
  tracks!: Table<GmtwTrack, string>;
  runs!: Table<RunRecord, string>;
  customMarkers!: Table<CustomMarker, string>;
  trackMeta!: Table<TrackMeta, string>;
  locsOverrides!: Table<LocsOverride, string>;

  constructor() {
    super('gmtw-database');
    this.version(1).stores({
      projects: 'id, createdAt',
      tracks: 'id, projectId, cat, createdAt',
      runs: 'id, trackId, date',
      customMarkers: 'id, projectId, createdAt',
      trackMeta: 'trackId',
      locsOverrides: 'id'
    });
  }
}

/** Singleton-Instanz — exportiert für alle Stores */
export const db = new GMTWDatabase();

// =============================================================================
// Migrations-Hilfsfunktionen (Legacy-localStorage → Dexie)
// =============================================================================

/** Serialisierbares Track-Objekt (ohne Leaflet-Laufzeit-Objekte) */
export function serializeTrack(track: GmtwTrack): GmtwTrack {
  const { gpxLayer, _startMkr, _finishMkr, _featureMarkers, ...rest } = track as GmtwTrack & {
    gpxLayer?: unknown;
    _startMkr?: unknown;
    _finishMkr?: unknown;
    _featureMarkers?: unknown[];
  };
  void gpxLayer; void _startMkr; void _finishMkr; void _featureMarkers;
  return rest;
}

/** Serialisierbares CustomMarker-Objekt (ohne Leaflet-Layer) */
export function serializeMarker(cm: CustomMarker): CustomMarker {
  const { _layer, ...rest } = cm as CustomMarker & { _layer?: unknown };
  void _layer;
  return rest;
}
