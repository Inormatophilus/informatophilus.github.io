// =============================================================================
// GMTW Trail Map — TypeScript Interfaces & Types
// =============================================================================

// --- Language & i18n ---------------------------------------------------------

export type Lang = 'de' | 'en' | 'fr' | 'es' | 'it';

export type TrackCat = 'beginner' | 'mittel' | 'expert' | 'optional-logistik' | 'custom';

// --- GPS / Geometry ----------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GpxPoint extends LatLng {
  ele?: number;
  time?: number; // unix timestamp ms
}

export interface TrackBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// --- Track Stats -------------------------------------------------------------

export interface TrackStats {
  distKm: number;
  elevGain: number;
  elevLoss: number;
  maxElev: number;
  minElev: number;
  durationMs: number;
  topSpeedKmh?: number;
  avgSpeedKmh?: number;
}

// --- Track Features (geo-tagged points of interest) -------------------------

export type FeatureType =
  | 'drop'
  | 'gap'
  | 'root'
  | 'rock'
  | 'steinfeld'
  | 'verblockt'
  | 'steil'
  | 'northshore'
  | 'sprung'
  | 'flow'
  | 'aussicht'
  | 'goal'
  | 'pause';

/** Zustand der Streckenoberfläche */
export type TrackCondition = 'dry' | 'muddy' | 'icy' | 'unknown';

export interface TrackFeature {
  id?: string;        // UUID — wird bei addFeature auto-generiert; optional für Migrations-Kompatibilität
  type: FeatureType;
  name: string;
  diff: number;       // 1=Beginner, 2=Mittel, 3=Expert
  date: number;       // unix timestamp ms
  lat: number;
  lng: number;
}

// --- Track Edit History ------------------------------------------------------

export interface TrackEdit {
  type: string;
  newVal: string;
  oldVal: string;
  name: string; // display name of edit
  date: number; // unix timestamp ms
}

// --- GPX Track ---------------------------------------------------------------

export interface GmtwTrack {
  id: string;
  name: string;
  cat: TrackCat;
  color: string;
  gpxString: string;
  stats: TrackStats;
  visible: boolean;
  projectId: string;
  createdAt: number;
  bounds?: TrackBounds;
  sourceUrl?: string;
}

// --- GPX Parse Result --------------------------------------------------------

export interface GpxData {
  points: GpxPoint[];
  name: string;
  desc?: string;
  stats: TrackStats;
  bounds: TrackBounds;
}

// --- LOCS (Predefined Markers) -----------------------------------------------

export interface LocMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  color: string; // hex
  emoji: string;
  cat: TrackCat | 'optional-logistik';
  desc: string;
  nameI18n?: Partial<Record<Lang, string>>;
  descI18n?: Partial<Record<Lang, string>>;
  // Runtime overrides (from DB)
  _overrideName?: string;
  _overrideEmoji?: string;
  _hidden?: boolean;
  // Leaflet runtime
  _layer?: unknown; // L.Marker
}

export interface LocsOverride {
  id: string;
  name?: string;
  emoji?: string;
  isHidden?: boolean;
}

// --- Custom Markers ----------------------------------------------------------

export interface CustomMarker {
  id: string;
  name: string;
  cat: string;
  emoji: string;
  desc: string;
  gmapsUrl: string;
  lat: number;
  lng: number;
  projectId: string;
  createdAt: number;
  // Runtime
  _layer?: unknown; // L.Marker
}

// --- Projects ----------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  enabled: boolean;
  createdAt: number;
}

// --- User Profile ------------------------------------------------------------

export interface UserProfile {
  name: string;
  muniName: string;
  wheelSize: string; // '19'|'24'|'26'|'29'|'36'
  color: string;
  brake: string;
  seatClampColor: string; // used in HMAC payload (anti-cheat)
  special: string;
  avatarEmoji: string;
  avatarBg: string;
  lang: Lang;
  homeLat?: number;
  homeLng?: number;
}

// --- Accessibility -----------------------------------------------------------

export interface A11ySettings {
  enabled: boolean;
  rate: number; // 0.5 - 2.0
  hc: boolean; // high contrast
  autoAnnounce: boolean;
}

// --- Race / Run System -------------------------------------------------------

export type RaceStateEnum =
  | 'idle'
  | 'approaching'
  | 'at_line'
  | 'go'
  | 'racing'
  | 'finished';

export type FallType = 'fall' | 'dismount';

export interface FallEvent {
  type: FallType;
  ts: number; // unix timestamp ms from race start
  lat: number;
  lng: number;
}

export interface RunRecord {
  id: string;
  trackId: string;
  date: string; // YYYY-MM-DD
  totalMs: number;
  splits: number[]; // ms per sector (4 sectors)
  fallEvents: FallEvent[];
  riderName: string;
  muniName: string;
  wheelSize: string;
  seatClampColor: string;
  signature: string; // HMAC-SHA256 (first 24 hex chars)
}

export interface RunCache {
  [trackId: string]: {
    [runId: string]: RunRecord;
  };
}

// --- Race Engine State -------------------------------------------------------

export interface RaceEngineState {
  state: RaceStateEnum;
  trackId: string | null;
  checkpoints: LatLng[]; // [cp1, cp2, cp3, finish]
  nextCpIdx: number;
  distToStart: number;
  minDistToStart: number;
  armed: boolean;
  startTs: number;
  splits: number[];
  fallEvents: FallEvent[];
  // Bluetooth GPS
  btConnected: boolean;
  btGpsLat: number;
  btGpsLng: number;
  btGpsTs: number;
  // Motion sensor
  lastAccelMag: number;
  lastImpactTs: number;
  // GPS
  lastLat: number;
  lastLng: number;
  lastGpsTs: number;
  lastSpeedKmh: number;
}

// --- QR Code System ----------------------------------------------------------

/**
 * Vollständige Track-Metadaten für QR-Transfer.
 * Enthält alles was zu einem Track gehört: Features, Bewertung, Beschreibung,
 * Streckenzustand, Bearbeitungshistorie und optional Rennzeiten.
 */
export interface TrackShareData {
  desc?: string;               // Beschreibung (max 400 Zeichen)
  rating?: number;             // 0-5 Sterne
  cond?: string;               // TrackCondition: dry|muddy|icy|unknown
  features?: TrackFeature[];   // Schlüsselstellen (vollständig strukturiert)
  edits?: TrackEdit[];         // Bearbeitungshistorie
  runs?: RunRecord[];          // Rennzeiten (optional, per Toggle)
}

export type QrPayloadType =
  | 'track'
  | 'tracks'
  | 'project'
  | 'backup'
  | 'marker'
  | 'markers'
  | 'run'
  | 'json';

export interface QrChunk {
  idx: number;
  total: number;
  type: QrPayloadType;
  version: number;
  data: string; // base64url encoded chunk
  first?: boolean;  // true on first chunk of a sequence
  last?: boolean;   // true on final chunk of a sequence
  name?: string;    // track/payload name for display
  checksum?: string; // CRC of full payload for verification
}

export interface QrChunkBuffer {
  total: number;
  type: QrPayloadType;
  version: number;
  chunks: Map<number, string>;
}

// --- Backup ------------------------------------------------------------------

export interface BackupSettings {
  gpsEmoji: string;
  homeRegion: LatLng | null;
  theme: 'dark' | 'light';
  lastView: { lat: number; lng: number; zoom: number } | null;
  markerScale: number;
  locsHidden: string[];
  locsOverrides: Record<string, LocsOverride>;
  profile: UserProfile | null;
  a11y?: A11ySettings;
  projects: Project[];
  activeProjectId: string | null;
  lang: Lang;
}

export interface BackupV8 {
  _app: string; // 'gmtw-backup-v8'
  exportedAt: string; // ISO date
  tracks: GmtwTrack[];
  runs: RunRecord[];
  customMarkers: CustomMarker[];
  trkFeatures: Record<string, TrackFeature[]>;
  trkRatings: Record<string, number>;
  trkEdits: Record<string, TrackEdit[]>;
  settings: BackupSettings;
}

// --- Storage Keys ------------------------------------------------------------

export const LS_KEYS = {
  TRACKS: 'gmtw_tracks_v2',
  RUNS: 'gmtw_runs_v1',
  REC: 'gmtw_rec_v2',
  VIEW: 'gmtw_view_v1',
  THEME: 'gmtw_theme',
  GPS_EMOJI: 'gmtw_gps_emoji',
  HOME_REGION: 'gmtw_home_region',
  CUSTOM_MARKERS: 'gmtw_custom_markers_v1',
  PROFILE: 'gmtw_profile_v1',
  A11Y: 'gmtw_a11y_v1',
  PROJECTS: 'gmtw_projects_v1',
  ACTIVE_PROJECT: 'gmtw_active_project_v1',
  LANG: 'gmtw_lang_v1',
  MARKER_SCALE: 'gmtw_marker_scale',
  LOCS_HIDDEN: 'gmtw_locs_hidden',
  LOCS_OVERRIDES: 'gmtw_locs_overrides',
  TRK_RATINGS: 'gmtw_trk_ratings_v1',
  TRK_FEATURES: 'gmtw_trk_features_v1',
  TRK_EDITS: 'gmtw_trk_edits_v1',
  INSTALL_DECLINE_TS: 'gmtw_install_decline_ts',
  INSTALL_DECLINE_PERM: 'gmtw_install_decline_perm',
} as const;

// --- Service Worker Messages -------------------------------------------------

export type SwMessageType =
  | 'SKIP_WAITING'
  | 'CLEAR_TILE_CACHE'
  | 'PREFETCH_GPX'
  | 'PREFETCH_TILES'
  | 'GET_CACHE_SIZE'
  | 'CLEAR_ALL_CACHES';

export interface SwPrefetchTilesMsg {
  type: 'PREFETCH_TILES';
  urls: string[];
}

export interface SwPrefetchGpxMsg {
  type: 'PREFETCH_GPX';
  urls: string[];
}

export interface SwCacheSizeResult {
  tiles: number;
  shell: number;
  data: number;
  gpx: number;
  fonts: number;
  total: number;
}

// --- Navigation HUD ----------------------------------------------------------

export interface NavState {
  active: boolean;
  trackId: string | null;
  cpIdx: number;
  distToNext: number; // meters
  crossTrackErr: number; // meters (negative = left, positive = right)
  bearingToNext: number; // degrees
  nextLabel: string;
  totalDist: number;
  coveredDist: number;
}

// --- Recording ---------------------------------------------------------------

export interface RecordingState {
  active: boolean;
  paused: boolean;
  points: GpxPoint[];
  totalDistM: number;
  startTs: number;
  elapsed: number; // seconds
  name: string;
  riderName: string;
  muniName: string;
  notes: string;
  topSpeedKmh: number;
  gpsErrors: number;
}

// --- Feature Icons & Names Constants ----------------------------------------

export const FEAT_ICONS: Record<FeatureType, string> = {
  drop:       '🦘',
  gap:        '🕳️',
  root:       '🌿',
  rock:       '🗿',
  steinfeld:  '⛏️',
  verblockt:  '🧱',
  steil:      '⛰️',
  northshore: '🪵',
  sprung:     '🚀',
  flow:       '🌊',
  aussicht:   '👁️',
  goal:       '🏆',
  pause:      '☕'
};

export const FEAT_NAMES: Record<FeatureType, string> = {
  drop: 'Drop',
  gap: 'Gap',
  root: 'Wurzeln',
  rock: 'Fels',
  steinfeld: 'Steinfeld',
  verblockt: 'Verblockt',
  steil: 'Steile Passage',
  northshore: 'Northshore',
  sprung: 'Sprung',
  flow: 'Flow-Section',
  aussicht: 'Aussichtspunkt',
  goal: 'Ziel / Checkpoint',
  pause: 'Pausenpunkt'
};

// --- Track Category Colors ---------------------------------------------------

export const CAT_COLORS: Record<string, string> = {
  beginner: '#22c55e',
  mittel: '#f59e0b',
  expert: '#ef4444',
  'optional-logistik': '#38bdf8',
  custom: '#a855f7'
};

export const CAT_EMOJIS: Record<string, string> = {
  beginner: '🟢',
  mittel: '🟡',
  expert: '🔴',
  'optional-logistik': '🔵',
  custom: '🟣'
};
