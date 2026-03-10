// =============================================================================
// GMTW Trail Map — QR-Code Master-Engine v2
//
// Professionelles Multi-QR-System für GPX-Track-Sharing zwischen Geräten.
//
// Encoding: RDP-Vereinfachung → Delta-Encoding → pako DEFLATE → Base64URL → Chunking
// Decoding: Chunk-Sammlung → Base64URL → inflate → Reconstruct GPX
// Animation: QRAnimator-Klasse für animierte QR-Sequenzen
// Auto-Detect: Payload-Typ erkennen (track/tracks/project/backup/marker/json)
//
// v2-Protokoll: Jeder Chunk enthält first/last Flags + Track-Name + CRC
// =============================================================================

import pako from 'pako';
import qrcodeGenerator from 'qrcode-generator';
import type {
  GpxPoint, GmtwTrack, QrChunk, QrChunkBuffer, QrPayloadType,
  TrackShareData, TrackFeature, TrackEdit, RunRecord
} from '$lib/types';
import { simplifyPoints } from './geo';
import { parseGpx, buildGpxString } from './gpx';

// --- Konfiguration -----------------------------------------------------------

/**
 * Zeichen pro QR-Code Chunk.
 * 250 Zeichen + ~60 Byte JSON-Wrapper = ~310 Bytes total.
 * → QR Version 9 (53 Module) mit ECL M passt → ~5.6px/Modul bei 340px Canvas.
 * Outdoor-Scanning zwischen Handys zuverlässig möglich.
 */
export const QR_CHUNK_SIZE = 250;

/** Max. Punkte nach RDP-Vereinfachung */
export const QR_MAX_PTS = 1000;

/** Protokoll-Version (v2 = first/last Flags + name + checksum) */
export const QR_VERSION = 2;

/** Minimale Modulgröße in Pixeln für zuverlässiges Scannen */
const MIN_MODULE_PX = 4;

// --- CRC16 für Payload-Verifizierung ----------------------------------------

function crc16(str: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
  }
  return crc.toString(16).padStart(4, '0');
}

// --- Base64URL Codec ---------------------------------------------------------

export function b64uEncode(u8: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return u8;
}

// --- Encoding: Track → QR-Chunks ---------------------------------------------

/** Extrahiert GpxPoints aus einem GPX-XML-String */
export function parseGpxPoints(gpxStr: string): GpxPoint[] {
  try {
    return parseGpx(gpxStr).points;
  } catch {
    return [];
  }
}

/**
 * Compact-Encoding v2: Punkte + vollständige Metadaten → DEFLATE.
 *
 * Enthält ALLES was zu einem Track gehört:
 * - Delta-kodierte Koordinaten (~60% Ersparnis)
 * - Schlüsselstellen (Features) als strukturierte Daten
 * - Bewertung, Beschreibung, Streckenzustand
 * - Optional: Rennzeiten mit Splits und Stürzen
 *
 * @param track  GmtwTrack (Name, Kategorie, Farbe)
 * @param pts    Nur Track-Punkte (KEINE Feature-Waypoints!)
 * @param meta   Optionale Metadaten (Features, Rating, Runs, etc.)
 */
export function encodeTrackCompact(
  track: GmtwTrack,
  pts: GpxPoint[],
  meta?: TrackShareData
): Uint8Array {
  const simplified = simplifyPoints(pts, QR_MAX_PTS);

  // Delta-Encoding (×1e5 für ~1m Präzision)
  const lats: number[] = [];
  const lngs: number[] = [];
  const eles: number[] = [];
  let prevLat = 0, prevLng = 0, prevEle = 0;

  for (const p of simplified) {
    const dlat = Math.round(p.lat * 1e5) - prevLat;
    const dlng = Math.round(p.lng * 1e5) - prevLng;
    const dele = Math.round((p.ele ?? 0) * 10) - prevEle;
    lats.push(dlat);
    lngs.push(dlng);
    eles.push(dele);
    prevLat += dlat;
    prevLng += dlng;
    prevEle += dele;
  }

  // Basis-Payload mit Koordinaten
  const payload: Record<string, unknown> = {
    v: QR_VERSION,
    n: track.name,
    c: track.cat,
    col: track.color,
    lats,
    lngs,
    eles,
    total: simplified.length
  };

  // v2: Metadaten hinzufügen (kompakt benannt um Platz zu sparen)
  if (meta) {
    if (meta.desc) payload.desc = meta.desc;
    if (meta.rating !== undefined && meta.rating > 0) payload.rat = meta.rating;
    if (meta.cond && meta.cond !== 'unknown') payload.cond = meta.cond;

    // Features kompakt kodieren (ohne id/date — werden beim Import neu generiert)
    if (meta.features && meta.features.length > 0) {
      payload.feats = meta.features.map(f => ({
        t: f.type,
        d: f.diff,
        n: f.name,
        la: Math.round(f.lat * 1e6) / 1e6,
        ln: Math.round(f.lng * 1e6) / 1e6,
      }));
    }

    // Bearbeitungshistorie (letzte 10, kompakt)
    if (meta.edits && meta.edits.length > 0) {
      payload.edits = meta.edits.slice(0, 10).map(e => ({
        t: e.type,
        nv: e.newVal,
        ov: e.oldVal,
        nm: e.name,
      }));
    }

    // Rennzeiten kompakt kodieren (optional, nur wenn runs[] nicht leer)
    if (meta.runs && meta.runs.length > 0) {
      payload.runs = meta.runs.map(r => ({
        ms: r.totalMs,
        sp: r.splits,
        d: r.date,
        r: r.riderName,
        m: r.muniName,
        w: r.wheelSize,
        sc: r.seatClampColor,
        sig: r.signature,
        fc: r.fallEvents.length, // Sturzanzahl
        fe: r.fallEvents.length > 0
          ? r.fallEvents.map(f => ({ t: f.type, ts: f.ts, la: f.lat, ln: f.lng }))
          : undefined,
      }));
    }
  }

  return pako.deflate(JSON.stringify(payload), { level: 9 });
}

/** Kodiert ein beliebiges JSON-Objekt als komprimierter Payload */
export function encodeJsonCompact(obj: unknown): Uint8Array {
  return pako.deflate(JSON.stringify(obj), { level: 9 });
}

/**
 * Zerlegt komprimierten Payload in Chunks mit v2-Protokoll.
 * Jeder Chunk enthält:
 * - idx/total für Position in der Sequenz
 * - first=true auf dem ersten, last=true auf dem letzten
 * - name für UI-Anzeige
 * - checksum (CRC16 des gesamten Base64-Payloads) zur Verifizierung
 */
export function buildChunks(data: Uint8Array, type: QrPayloadType, name?: string): string[] {
  const encoded = b64uEncode(data);
  const checksum = crc16(encoded);
  const chunks: string[] = [];
  const total = Math.max(1, Math.ceil(encoded.length / QR_CHUNK_SIZE));

  for (let i = 0; i < total; i++) {
    const slice = encoded.slice(i * QR_CHUNK_SIZE, (i + 1) * QR_CHUNK_SIZE);
    const chunkObj: QrChunk = {
      idx: i,
      total,
      type,
      version: QR_VERSION,
      data: slice,
    };
    // v2: first/last Flags für klare Sequenz-Erkennung
    if (i === 0) {
      chunkObj.first = true;
      if (name) chunkObj.name = name.slice(0, 30); // Kompakter Name
    }
    if (i === total - 1) {
      chunkObj.last = true;
      chunkObj.checksum = checksum;
    }
    chunks.push(JSON.stringify(chunkObj));
  }
  return chunks;
}

/**
 * Vollständiger Encode-Workflow: Track + alle Metadaten → QR-Chunks.
 *
 * WICHTIG: Verwendet track.gpxString direkt (NUR trkpt-Punkte).
 * Features werden als strukturierte Daten im Payload kodiert,
 * NICHT als GPX-Waypoints (das verhindert Korruption der Trackgeometrie).
 *
 * @param track  GmtwTrack mit gpxString
 * @param meta   Optionale Metadaten (Features, Rating, Runs, etc.)
 */
export function encodeTrackToChunks(track: GmtwTrack, meta?: TrackShareData): string[] {
  // NUR echte Track-Punkte extrahieren (keine Feature-Waypoints)
  const pts = parseGpxTrackPoints(track.gpxString);
  if (pts.length === 0) return [];
  const compressed = encodeTrackCompact(track, pts, meta);
  return buildChunks(compressed, 'track', track.name);
}

/**
 * Extrahiert NUR trkpt-Elemente aus GPX (KEINE wpt/rtept).
 * Verhindert dass Feature-Waypoints in die Trackgeometrie gelangen.
 */
function parseGpxTrackPoints(gpxStr: string): GpxPoint[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxStr, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const ptEls = Array.from(doc.querySelectorAll('trkpt'));
    return ptEls
      .map((el): GpxPoint | null => {
        const lat = parseFloat(el.getAttribute('lat') ?? '');
        const lng = parseFloat(el.getAttribute('lon') ?? '');
        if (isNaN(lat) || isNaN(lng)) return null;
        const eleRaw = parseFloat(el.querySelector('ele')?.textContent ?? '');
        const timeStr = el.querySelector('time')?.textContent ?? '';
        return {
          lat, lng,
          ele: isNaN(eleRaw) ? undefined : eleRaw,
          time: timeStr ? new Date(timeStr).getTime() : undefined
        };
      })
      .filter((p): p is GpxPoint => p !== null);
  } catch {
    // Fallback: parseGpxPoints (inkl. wpt) wenn trkpt-Parsing fehlschlägt
    return parseGpxPoints(gpxStr);
  }
}

/** Vollständiger Encode-Workflow: beliebiges JSON → Chunks */
export function encodeObjectToChunks(obj: unknown, type: QrPayloadType, name?: string): string[] {
  const compressed = encodeJsonCompact(obj);
  return buildChunks(compressed, type, name);
}

// --- Decoding: QR-String → GPX/JSON -----------------------------------------

/** Parst einen QR-Code-String zu einem QrChunk-Objekt (v1 + v2 kompatibel) */
export function parseChunkPayload(raw: string): QrChunk | null {
  try {
    const obj = JSON.parse(raw) as QrChunk;
    if (
      typeof obj.idx === 'number' &&
      typeof obj.total === 'number' &&
      typeof obj.type === 'string' &&
      typeof obj.data === 'string'
    ) {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

/** Sammelt Chunks; gibt true zurück wenn alle Chunks vorliegen */
export function collectChunk(chunk: QrChunk, buffer: QrChunkBuffer): boolean {
  buffer.chunks.set(chunk.idx, chunk.data);
  buffer.total = chunk.total;
  buffer.type = chunk.type;
  buffer.version = chunk.version;
  return buffer.chunks.size === chunk.total;
}

/** Rekonstruiert Payload aus QrChunkBuffer, optional mit CRC-Verifikation */
export function assembleChunks(buffer: QrChunkBuffer, expectedChecksum?: string): Uint8Array {
  const parts: string[] = [];
  for (let i = 0; i < buffer.total; i++) {
    const chunk = buffer.chunks.get(i);
    if (!chunk) throw new Error(`Fehlender Chunk ${i}/${buffer.total}`);
    parts.push(chunk);
  }
  const full = parts.join('');

  // v2: CRC-Verifizierung wenn Checksum vorhanden
  if (expectedChecksum) {
    const actual = crc16(full);
    if (actual !== expectedChecksum) {
      throw new Error(`Prüfsumme ungültig (erwartet: ${expectedChecksum}, erhalten: ${actual}). Bitte erneut scannen.`);
    }
  }

  return b64uDecode(full);
}

/** Dekomprimiert Payload zurück zu JSON-String */
export function decompressPayload(data: Uint8Array): string {
  return pako.inflate(data, { to: 'string' });
}

/** Ergebnis-Typ für vollständiges Track-Decoding (v2) */
export interface DecodedTrackResult {
  points: GpxPoint[];
  name: string;
  cat: string;
  color: string;
  // v2: Metadaten
  desc?: string;
  rating?: number;
  cond?: string;
  features?: TrackFeature[];
  edits?: TrackEdit[];
  runs?: RunRecord[];
}

/**
 * Rekonstruiert GPX-Track + alle Metadaten aus compact-encoded Payload (v1+v2 kompatibel).
 * Delta-Decoding → absolute Koordinaten.
 * v2: Zusätzlich Features, Bewertung, Rennzeiten etc.
 */
export function decodeCompactToTrack(jsonStr: string): DecodedTrackResult {
  const p = JSON.parse(jsonStr) as Record<string, unknown>;

  // Delta-Decoding der Koordinaten
  const lats = p.lats as number[];
  const lngs = p.lngs as number[];
  const eles = p.eles as number[];

  const points: GpxPoint[] = [];
  let accLat = 0, accLng = 0, accEle = 0;

  for (let i = 0; i < lats.length; i++) {
    accLat += lats[i];
    accLng += lngs[i];
    accEle += eles[i];
    points.push({
      lat: accLat / 1e5,
      lng: accLng / 1e5,
      ele: accEle / 10
    });
  }

  const result: DecodedTrackResult = {
    points,
    name: (p.n as string) || 'QR-Track',
    cat: (p.c as string) || 'custom',
    color: (p.col as string) || '#a855f7'
  };

  // v2: Metadaten extrahieren (falls vorhanden)
  if (p.desc) result.desc = p.desc as string;
  if (p.rat !== undefined) result.rating = p.rat as number;
  if (p.cond) result.cond = p.cond as string;

  // v2: Features rekonstruieren
  if (Array.isArray(p.feats)) {
    result.features = (p.feats as Array<{ t: string; d: number; n: string; la: number; ln: number }>).map(f => ({
      id: `feat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: f.t as TrackFeature['type'],
      diff: f.d,
      name: f.n,
      lat: f.la,
      lng: f.ln,
      date: Date.now(),
    }));
  }

  // v2: Bearbeitungshistorie rekonstruieren
  if (Array.isArray(p.edits)) {
    result.edits = (p.edits as Array<{ t: string; nv: string; ov: string; nm: string }>).map(e => ({
      type: e.t,
      newVal: e.nv,
      oldVal: e.ov,
      name: e.nm,
      date: Date.now(),
    }));
  }

  // v2: Rennzeiten rekonstruieren
  if (Array.isArray(p.runs)) {
    result.runs = (p.runs as Array<{
      ms: number; sp: number[]; d: string; r: string; m: string;
      w: string; sc: string; sig: string; fc: number;
      fe?: Array<{ t: string; ts: number; la: number; ln: number }>;
    }>).map(r => ({
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      trackId: '', // Wird beim Import auf die neue Track-ID gesetzt
      date: r.d,
      totalMs: r.ms,
      splits: r.sp,
      riderName: r.r,
      muniName: r.m,
      wheelSize: r.w,
      seatClampColor: r.sc,
      signature: r.sig,
      fallEvents: r.fe?.map(f => ({
        type: f.t as 'fall' | 'dismount',
        ts: f.ts,
        lat: f.la,
        lng: f.ln,
      })) ?? [],
    }));
  }

  return result;
}

/**
 * Auto-Detect des Payload-Typs nach Dekomprimierung.
 */
export function detectPayloadType(decoded: unknown): QrPayloadType {
  if (typeof decoded !== 'object' || decoded === null) return 'json';
  const obj = decoded as Record<string, unknown>;
  if (obj._app === 'gmtw-backup-v8') return 'backup';
  if (obj.v !== undefined && obj.lats && obj.lngs) return 'track';
  if (Array.isArray(obj.tracks)) return 'tracks';
  if (obj.id && obj.name && obj.centerLat) return 'project';
  if (obj.id && obj.lat && obj.lng && obj.emoji) return 'marker';
  if (Array.isArray(obj)) {
    const first = (obj as unknown[])[0];
    if (typeof first === 'object' && first !== null) {
      const f = first as Record<string, unknown>;
      if (f.lat && f.lng && f.emoji) return 'markers';
      if (f.v && f.lats) return 'tracks';
    }
  }
  return 'json';
}

// --- QR-Code Rendering (qrcode-generator) ------------------------------------

/**
 * Zeichnet QR-Code auf Canvas-Element.
 * v2: Erzwingt Mindestgröße pro Modul (MIN_MODULE_PX) für zuverlässiges Outdoor-Scanning.
 * Verwendet ECL 'M' (15% Fehlerkorrektur) statt 'L' für bessere Erkennung.
 */
export function renderQrCanvas(
  canvas: HTMLCanvasElement,
  data: string,
  size = 340,
  fg = '#000000',
  bg = '#ffffff'
): void {
  try {
    const qrFn = (qrcodeGenerator as unknown as { default?: typeof qrcodeGenerator }).default ?? qrcodeGenerator;
    const qr = qrFn(0, 'M'); // ECL 'M' = 15% Fehlerkorrektur → robuster Outdoor
    qr.addData(data);
    qr.make();
    const modules = qr.getModuleCount();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Quiet Zone: 4 Module Weißraum (ISO/IEC 18004)
    const quietZone = 4;
    const totalModules = modules + quietZone * 2;

    // v2: Sicherstellen, dass jedes Modul mindestens MIN_MODULE_PX breit ist
    const cellSize = Math.max(MIN_MODULE_PX, Math.floor(size / totalModules));
    const actualSize = cellSize * totalModules;

    canvas.width = actualSize;
    canvas.height = actualSize;

    // Hintergrund komplett weiß (inkl. Quiet Zone) — crisp, kein Antialiasing
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, actualSize, actualSize);

    // QR-Module mit Offset für Quiet Zone — ganzzahlige Pixel, kein Blur
    ctx.fillStyle = fg;
    const offset = quietZone * cellSize;
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            offset + c * cellSize,
            offset + r * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
  } catch (e) {
    console.error('QR Render-Fehler:', e);
  }
}

// --- QRAnimator: Animierte QR-Sequenz ----------------------------------------

export class QRAnimator {
  private chunks: string[] = [];
  private currentIdx = 0;
  private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fps: number;
  private fg: string;
  private bg: string;
  private size: number;

  /** Callback: wird nach jedem Frame-Wechsel aufgerufen */
  onFrame?: (idx: number, total: number) => void;

  constructor(fps = 2.5, size = 340, fg = '#000000', bg = '#ffffff') {
    this.fps = fps;
    this.size = size;
    this.fg = fg;
    this.bg = bg;
  }

  /** Startet Animation mit gegebenen Chunks */
  start(chunks: string[], canvas: HTMLCanvasElement): void {
    this.stop();
    this.chunks = chunks;
    this.canvas = canvas;
    this.currentIdx = 0;
    if (chunks.length === 0) return;
    this.renderCurrent();
    if (chunks.length > 1) {
      this.timer = setInterval(() => {
        this.currentIdx = (this.currentIdx + 1) % this.chunks.length;
        this.renderCurrent();
      }, 1000 / this.fps);
    }
  }

  /** Setzt Animation am aktuellen Frame fort (nach stop()) */
  resume(): void {
    if (this.chunks.length === 0 || !this.canvas) return;
    this.renderCurrent();
    if (this.chunks.length > 1) {
      this.timer = setInterval(() => {
        this.currentIdx = (this.currentIdx + 1) % this.chunks.length;
        this.renderCurrent();
      }, 1000 / this.fps);
    }
  }

  /** Stoppt Animation */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Zeigt vorherigen Chunk */
  prev(): void {
    if (this.chunks.length === 0) return;
    this.currentIdx = (this.currentIdx - 1 + this.chunks.length) % this.chunks.length;
    this.renderCurrent();
  }

  /** Zeigt nächsten Chunk */
  next(): void {
    if (this.chunks.length === 0) return;
    this.currentIdx = (this.currentIdx + 1) % this.chunks.length;
    this.renderCurrent();
  }

  get total(): number { return this.chunks.length; }
  get index(): number { return this.currentIdx; }

  /** Gibt Metadaten des aktuellen Chunks zurück (v2: name, first, last) */
  get currentChunkMeta(): { first?: boolean; last?: boolean; name?: string } | null {
    if (this.chunks.length === 0) return null;
    try {
      const obj = JSON.parse(this.chunks[this.currentIdx]) as QrChunk;
      return { first: obj.first, last: obj.last, name: obj.name };
    } catch { return null; }
  }

  private renderCurrent(): void {
    if (!this.canvas || this.chunks.length === 0) return;
    renderQrCanvas(this.canvas, this.chunks[this.currentIdx], this.size, this.fg, this.bg);
    this.onFrame?.(this.currentIdx, this.chunks.length);
  }
}

// --- Chunk-Buffer-Factory ----------------------------------------------------

export function createChunkBuffer(): QrChunkBuffer {
  return { total: 0, type: 'json', version: QR_VERSION, chunks: new Map() };
}

// --- Einzel-QR für einfache Daten (Marker-Position, Ergebnis-QR) ------------

/** Erzeugt einfachen QR-Code-String für einen Marker */
export function encodeMarkerQr(lat: number, lng: number, name: string): string {
  return JSON.stringify({ type: 'gmtw-marker', lat, lng, name, v: QR_VERSION });
}

/** Erzeugt Google-Maps-Link QR */
export function encodeMapsQr(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// =============================================================================
// Multi-Format Input Processing
// GeoJSON, GPX XML, URLs, Compact JSON — unified import pipeline
// =============================================================================

/**
 * Konvertiert GeoJSON (FeatureCollection/Feature/LineString/MultiLineString)
 * in GpxPoints. GeoJSON-Koordinaten: [longitude, latitude, elevation?]
 */
export function geojsonToGpxPoints(
  geojson: unknown
): { points: GpxPoint[]; name: string } {
  const g = geojson as Record<string, unknown>;
  const rootName = (g.name as string) ?? 'GeoJSON Track';

  function coordsToPoints(coords: unknown[]): GpxPoint[] {
    return (coords as number[][])
      .filter(c => Array.isArray(c) && c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1]))
      .map(c => ({
        lng: c[0],
        lat: c[1],
        ele: c[2] !== undefined && !isNaN(c[2]) ? c[2] : undefined,
      }));
  }

  function fromGeometry(
    geo: Record<string, unknown>,
    n: string
  ): { points: GpxPoint[]; name: string } | null {
    if (geo.type === 'LineString') {
      return { points: coordsToPoints(geo.coordinates as unknown[]), name: n };
    }
    if (geo.type === 'MultiLineString') {
      const all = (geo.coordinates as unknown[][]).flatMap(line => coordsToPoints(line));
      return { points: all, name: n };
    }
    return null;
  }

  if (g.type === 'FeatureCollection') {
    for (const f of (g.features as Array<Record<string, unknown>>)) {
      const geo = f.geometry as Record<string, unknown>;
      const props = f.properties as Record<string, unknown> | null;
      const n = (props?.name as string) ?? rootName;
      const r = fromGeometry(geo, n);
      if (r && r.points.length >= 2) return r;
    }
    throw new Error('GeoJSON FeatureCollection enthält keine Linien-Geometrie');
  }
  if (g.type === 'Feature') {
    const geo = g.geometry as Record<string, unknown>;
    const props = g.properties as Record<string, unknown> | null;
    const r = fromGeometry(geo, (props?.name as string) ?? rootName);
    if (r) return r;
    throw new Error('GeoJSON Feature enthält keine Linien-Geometrie');
  }
  const direct = fromGeometry(g, rootName);
  if (direct && direct.points.length >= 2) return direct;
  throw new Error('GeoJSON-Format nicht erkannt');
}

/**
 * Baut einen GPX-String aus GpxPoints (thin wrapper um gpx.ts buildGpxString).
 */
export function buildGpxFromPoints(points: GpxPoint[], name: string, desc?: string): string {
  return buildGpxString(points, name, desc);
}

/**
 * Universeller Parser: akzeptiert GPX-XML, GeoJSON, GMTW-Compact-JSON.
 * Gibt immer { gpxStr, name, cat } zurück oder wirft einen Fehler.
 */
export function parseAnyFormatToGpx(
  input: string
): { gpxStr: string; name: string; cat: string } {
  const t = input.trim();

  // GPX XML
  if (t.startsWith('<?xml') || t.startsWith('<gpx') || t.startsWith('<GPX')) {
    const gpxData = parseGpx(t);
    return { gpxStr: t, name: gpxData.name, cat: 'custom' };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch {
    throw new Error('Unbekanntes Dateiformat — erwartet GPX (XML) oder JSON/GeoJSON');
  }
  const obj = parsed as Record<string, unknown>;

  // GeoJSON
  if (['FeatureCollection', 'Feature', 'LineString', 'MultiLineString'].includes(obj.type as string)) {
    const { points, name } = geojsonToGpxPoints(parsed);
    if (points.length < 2) throw new Error('GeoJSON enthält zu wenige Punkte');
    return { gpxStr: buildGpxFromPoints(points, name), name, cat: 'custom' };
  }

  // GMTW Compact track (delta-encoded)
  if (obj.v !== undefined && Array.isArray(obj.lats) && Array.isArray(obj.lngs)) {
    const decoded = decodeCompactToTrack(t);
    if (decoded.points.length < 2) throw new Error('Compact-Track hat zu wenige Punkte');
    return { gpxStr: buildGpxFromPoints(decoded.points, decoded.name), name: decoded.name, cat: decoded.cat };
  }

  throw new Error('JSON-Format nicht erkannt — kein GeoJSON und kein GMTW-Track');
}

/**
 * Holt eine URL (GPX / GeoJSON / JSON) und gibt den GPX-String zurück.
 * Timeout: 20 Sekunden.
 */
export async function fetchAndParseUrl(
  url: string
): Promise<{ gpxStr: string; name: string; cat: string }> {
  const filename = decodeURIComponent(url.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || 'Track';

  let text: string;
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 20_000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    text = await resp.text();
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') throw new Error('Timeout: URL nicht erreichbar (>20s)');
    throw new Error(`Netzwerkfehler: ${(e as Error).message}`);
  }

  return parseAnyFormatToGpx(text);
}

/**
 * Encodiert beliebige Text-Eingabe (GPX/GeoJSON/JSON) direkt in QR-Chunks.
 */
export function encodeAnyFormatToChunks(input: string, nameOverride?: string): string[] {
  const { gpxStr, name, cat } = parseAnyFormatToGpx(input);
  const pts = parseGpx(gpxStr).points;
  const fakeTrack: GmtwTrack = {
    id: '', name: nameOverride ?? name, cat: cat as GmtwTrack['cat'],
    color: '#a855f7', gpxString: gpxStr,
    stats: { distKm: 0, elevGain: 0, elevLoss: 0, maxElev: 0, minElev: 0, durationMs: 0 },
    visible: true, projectId: '', createdAt: 0,
  };
  return encodeTrackToChunks(fakeTrack);
}

// =============================================================================
// Fountain Codes (Luby Transform / LT Codes)
//
// Erlaubt Empfang in beliebiger Reihenfolge: Jede Teilmenge von k aus n Chunks
// reicht zur vollständigen Rekonstruktion aus (ohne sequentiellen Empfang).
//
// Algorithmus:
// - k Source-Blöcke (systematisch: erste k Chunks sind 1:1 Original)
// - n-k Redundanz-Blöcke (XOR zufälliger Source-Block-Teilmengen)
// - Decoder: Iteratives Peeling (Belief Propagation über GF(2))
// =============================================================================

const LT_BLOCK_BYTES = 700; // Source-Block-Größe in Bytes

export interface LtMeta {
  idx: number;   // Chunk-Index im Fountain-Stream
  k:   number;   // Anzahl Source-Blöcke
  n:   number;   // Gesamte Chunks im Stream
  sel: number[]; // Indices der XOR-verknüpften Source-Blöcke
}

/**
 * Kodiert komprimierte Binärdaten als Fountain (LT) Code.
 * Gibt n JSON-Strings zurück, die einzeln als QR-Codes gescannt werden.
 * Jede Teilmenge von k Chunks ermöglicht vollständige Rekonstruktion.
 *
 * @param data     Unkomprimierte oder komprimierte Daten (Uint8Array)
 * @param extra    Redundanz-Faktor (0.3 = 30% mehr Chunks als nötig)
 */
export function encodeFountainChunks(data: Uint8Array, extra = 0.35): string[] {
  const blockSize = LT_BLOCK_BYTES;
  const k         = Math.ceil(data.length / blockSize);
  const n         = Math.ceil(k * (1 + extra));

  // Aufgefüllt auf Vielfaches von blockSize
  const padded = new Uint8Array(k * blockSize);
  padded.set(data);

  const sources: Uint8Array[] = Array.from({ length: k }, (_, i) =>
    padded.slice(i * blockSize, (i + 1) * blockSize)
  );

  const chunks: string[] = [];

  for (let i = 0; i < n; i++) {
    const sel: number[] = i < k
      ? [i]                                      // systematisch (Original)
      : _ltSelectSources(k, _ltDegree(k, i), i); // Fountain (XOR)

    const block = new Uint8Array(blockSize);
    for (const s of sel) {
      for (let j = 0; j < blockSize; j++) block[j] ^= sources[s][j];
    }

    const meta: LtMeta = { idx: i, k, n, sel };
    chunks.push(JSON.stringify({ lt: 1, m: meta, d: b64uEncode(block) }));
  }

  return chunks;
}

/**
 * Dekodiert Fountain-Chunks via iterativem Peeling (Belief Propagation GF(2)).
 * Gibt die originalen komprimierten Daten zurück, oder null wenn zu wenige Chunks.
 *
 * @param rawChunks  Array aus JSON-Strings (lt=1 Format)
 * @param origLen    Originale Datenlänge vor Padding (optional, zum Trimmen)
 */
export function decodeFountainChunks(rawChunks: string[], origLen?: number): Uint8Array | null {
  type Node = { data: Uint8Array; sel: number[] };

  let k = 0;
  const nodes: Node[] = [];

  for (const raw of rawChunks) {
    try {
      const obj = JSON.parse(raw) as { lt: number; m: LtMeta; d: string };
      if (obj.lt !== 1 || !obj.m?.sel) continue;
      nodes.push({ data: b64uDecode(obj.d), sel: [...obj.m.sel] });
      k = Math.max(k, obj.m.k);
    } catch { /* skip */ }
  }

  if (k === 0 || nodes.length < k) return null;

  const blockSize = nodes[0].data.length;
  const recovered = new Array<Uint8Array | null>(k).fill(null);

  // Iteratives Peeling: Degree-1-Knoten direkt auflösen, dann propagieren
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      // Bekannte Source-Blöcke aus diesem Knoten eliminieren
      for (let s = node.sel.length - 1; s >= 0; s--) {
        const src = node.sel[s];
        if (recovered[src] === null) continue;
        for (let j = 0; j < blockSize; j++) node.data[j] ^= recovered[src]![j];
        node.sel.splice(s, 1);
        changed = true;
      }
      // Degree 1 → Source-Block direkt dekodiert
      if (node.sel.length === 1 && recovered[node.sel[0]] === null) {
        const src = node.sel[0];
        recovered[src] = new Uint8Array(node.data);
        node.sel = [];
        changed = true;
        // Propagiere zu allen anderen Knoten die diesen Source-Block enthalten
        for (const other of nodes) {
          const pos = other.sel.indexOf(src);
          if (pos === -1) continue;
          for (let j = 0; j < blockSize; j++) other.data[j] ^= recovered[src]![j];
          other.sel.splice(pos, 1);
        }
      }
    }
  }

  if (recovered.some(r => r === null)) return null;

  // Blöcke zusammensetzen
  const full = new Uint8Array(k * blockSize);
  for (let i = 0; i < k; i++) full.set(recovered[i]!, i * blockSize);

  return origLen !== undefined ? full.slice(0, origLen) : full;
}

/**
 * Prüft ob ein roher QR-String ein Fountain-Chunk ist.
 */
export function isFountainChunk(raw: string): boolean {
  try {
    const obj = JSON.parse(raw) as { lt?: number };
    return obj.lt === 1;
  } catch { return false; }
}

// ─── Interne LT-Code-Hilfsfunktionen ────────────────────────────────────────

/** Grad-Distribution (vereinfachte Robust-Soliton) */
function _ltDegree(k: number, seed: number): number {
  const r = _lcg(seed)() / 0x100000000;
  // P(1) = 1/k, P(d) ≈ 1/(d*(d-1)) für d>1
  let cum = 1 / k;
  if (r < cum) return 1;
  for (let d = 2; d <= k; d++) {
    cum += 1 / (d * (d - 1));
    if (r < cum) return d;
  }
  return k;
}

/** Wählt `degree` eindeutige Source-Block-Indices deterministisch */
function _ltSelectSources(k: number, degree: number, seed: number): number[] {
  const rng  = _lcg(seed ^ 0xbeef_cafe);
  const pool = Array.from({ length: k }, (_, i) => i);
  const sel: number[] = [];
  for (let d = 0; d < Math.min(degree, k); d++) {
    const idx = Math.floor((rng() / 0x100000000) * (pool.length - d));
    sel.push(pool[idx]);
    [pool[idx], pool[pool.length - 1 - d]] = [pool[pool.length - 1 - d], pool[idx]];
  }
  return sel;
}

/** Linear Congruential Generator (deterministische Pseudo-Zufallszahlen) */
function _lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s; };
}
