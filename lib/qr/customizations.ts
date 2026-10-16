/**
 * QR Code customizations.
 *
 * Models Bitly's documented design surface (spec sheet, section 06) as a single
 * validated object, so the same shape flows through the API, the database
 * (jsonb) and the designer UI without three drifting definitions.
 *
 * ---------------------------------------------------------------------------
 * An honest note on coverage
 * ---------------------------------------------------------------------------
 * Bitly publishes eleven dot patterns and nine corner shapes. The QR spec itself
 * has no concept of either — it is a fixed grid of modules. Dot and corner
 * styling is a *rendering* layer on top.
 *
 * We render through `qr-code-styling`, which offers exactly six dot types
 * (`square`, `dots`, `rounded`, `classy`, `classy-rounded`, `extra-rounded`) and
 * the same set for corner eyes/pips. Verified against the shipped bundle rather
 * than its README: there is no `sharp-vertical`.
 *
 * Exact reproductions:
 *
 *   'standard' | 'block' -> square        'circle'          -> dots
 *   'rounded'              -> rounded       'extra_round'     -> extra-rounded
 *
 * Approximations, closest available rendering:
 *
 *   'vertical'            -> extra-rounded
 *   'blob'                -> classy-rounded
 *   'horizontal'          -> classy
 *   'triangle'|'heart'|'star'|'diamond' -> classy
 *   'slightly_round'|'leaf'|'leaf_outer'|'target'|'concave'|'leaf_inner' -> classy family
 *
 * `supportsDotPattern` / `supportsCornerShape` let the designer mark an option
 * as approximated rather than silently substituting.
 *
 * Per-corner shapes
 * ---------------------------------------------------------------------------
 * Bitly allows a distinct shape on each of the three finder corners. The
 * renderer takes one `cornerSquareOptions` / `cornerDotOptions` for the whole
 * symbol and has no per-corner override, so **this is not rendered**. The
 * schema still stores three corners because it is what the API surface and the
 * stored jsonb should look like, but the designer applies corner 1's shape to
 * the symbol and says so, rather than implying three distinct corners render.
 */

/** Dot patterns published in the Bitly spec. */
export const DOT_PATTERNS = [
  'standard',
  'circle',
  'block',
  'blob',
  'rounded',
  'vertical',
  'horizontal',
  'triangle',
  'heart',
  'star',
  'diamond'
] as const;
export type DotPattern = (typeof DOT_PATTERNS)[number];

/** Corner shapes published in the Bitly spec, one per finder pattern. */
export const CORNER_SHAPES = [
  'standard',
  'slightly_round',
  'rounded',
  'extra_round',
  'leaf',
  'leaf_inner',
  'leaf_outer',
  'target',
  'concave'
] as const;
export type CornerShape = (typeof CORNER_SHAPES)[number];

/**
 * Patterns reproduced exactly by the renderer. Everything else is an
 * approximation; the designer labels those so the difference is visible.
 */
const EXACT_DOT_PATTERNS: ReadonlySet<string> = new Set([
  'standard',
  'block',
  'rounded',
  'circle'
]);

const EXACT_CORNER_SHAPES: ReadonlySet<string> = new Set([
  'standard',
  'slightly_round',
  'rounded',
  'extra_round'
]);

export function supportsDotPattern(pattern: string): boolean {
  return EXACT_DOT_PATTERNS.has(pattern);
}

export function supportsCornerShape(shape: string): boolean {
  return EXACT_CORNER_SHAPES.has(shape);
}

/** QR error-correction levels, in the spec's `spec_settings.error_correction`. */
export const ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type ErrorCorrectionLevel = (typeof ERROR_CORRECTION_LEVELS)[number];

export const MIN_ERROR_CORRECTION: ErrorCorrectionLevel = 'L';
export const MAX_ERROR_CORRECTION: ErrorCorrectionLevel = 'H';

export interface GradientStop {
  color: string;
  offset: number;
}

export interface Gradient {
  /** Bitly documents linear and radial. */
  style: 'linear' | 'radial';
  /** Degrees, for linear gradients only. */
  angle?: number;
  colors: GradientStop[];
  /** Bitly's `gradient.exclude_corners`. */
  excludeCorners?: boolean;
}

export interface CornerConfig {
  shape: CornerShape;
  color?: string;
}

/**
 * The three finder corners. Bitly's schema names these corner_1..3.
 * `shape` is the corner eye; the inner pip follows the renderer.
 *
 * Stored and validated for API fidelity, but only corner 1 reaches the canvas —
 * see the per-corner note at the top of this file.
 */
export interface Corners {
  corner1: CornerConfig;
  corner2: CornerConfig;
  corner3: CornerConfig;
}

export interface QrCustomizations {
  /** Bitly's `background_color`. Hex, optionally with alpha. */
  backgroundColor: string;
  /** Bitly's `dot_pattern_color`. */
  dotPatternColor: string;
  dotPattern: DotPattern;
  corners: Corners;
  gradient?: Gradient;
  backgroundGradient?: Gradient;
  /** Data URL or absolute https URL of a PNG logo. Bitly caps it at 5 MB. */
  logoUrl?: string;
  /** Bitly's `frame` + `text_label`. */
  frame?: FrameConfig;
  errorCorrection: ErrorCorrectionLevel;
}

export interface FrameConfig {
  style: 'none' | 'plain' | 'rounded';
  text?: string;
  color?: string;
}

/** Max logo size Bitly documents: 5 MB. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Image MIME types Bitly's renderer accepts for a logo. */
export const LOGO_MIME_TYPES = ['image/png'] as const;

export const DEFAULT_CUSTOMIZATIONS: QrCustomizations = {
  backgroundColor: '#ffffff',
  dotPatternColor: '#000000',
  dotPattern: 'standard',
  corners: {
    corner1: { shape: 'standard' },
    corner2: { shape: 'standard' },
    corner3: { shape: 'standard' }
  },
  errorCorrection: 'M'
};

export function defaultCustomizations(): QrCustomizations {
  return structuredClone(DEFAULT_CUSTOMIZATIONS);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Only `#rgb`, `#rrggbb`, `#rrggbbaa` — the documented hex forms. */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export interface ParseResult {
  ok: boolean;
  value: QrCustomizations;
  /** Human-readable problems. Empty when ok. */
  errors: string[];
}

/**
 * Parse and clamp a customization payload.
 *
 * Unknown keys are dropped rather than rejected: this object is persisted as
 * jsonb and will outlive any given client, so an older reader must not choke on
 * a newer writer's extra fields. Values that are *present but invalid* are
 * reported in `errors` and fall back to the default rather than throwing, so a
 * partially broken design still renders something scannable.
 */
export function parseCustomizations(input: unknown): ParseResult {
  const errors: string[] = [];
  const out = defaultCustomizations();

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    if (input !== undefined && input !== null) errors.push('customizations must be an object');
    return { ok: errors.length === 0, value: out, errors };
  }

  const raw = input as Record<string, unknown>;

  if (raw.backgroundColor !== undefined) {
    if (isHex(raw.backgroundColor)) out.backgroundColor = raw.backgroundColor;
    else errors.push('backgroundColor must be a hex colour');
  }

  if (raw.dotPatternColor !== undefined) {
    if (isHex(raw.dotPatternColor)) out.dotPatternColor = raw.dotPatternColor;
    else errors.push('dotPatternColor must be a hex colour');
  }

  if (raw.dotPattern !== undefined) {
    if (isOneOf(raw.dotPattern, DOT_PATTERNS)) out.dotPattern = raw.dotPattern;
    else errors.push(`dotPattern must be one of: ${DOT_PATTERNS.join(', ')}`);
  }

  if (raw.errorCorrection !== undefined) {
    if (isOneOf(raw.errorCorrection, ERROR_CORRECTION_LEVELS)) out.errorCorrection = raw.errorCorrection;
    else errors.push(`errorCorrection must be one of: ${ERROR_CORRECTION_LEVELS.join(', ')}`);
  }

  if (raw.corners !== undefined) {
    const c = raw.corners;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const cr = c as Record<string, unknown>;
      const keys = ['corner1', 'corner2', 'corner3'] as const;
      for (const k of keys) {
        const entry = cr[k];
        if (entry === undefined) continue;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`${k} must be an object`);
          continue;
        }
        const e = entry as Record<string, unknown>;
        const cfg = out.corners[k];
        if (e.shape !== undefined) {
          if (isOneOf(e.shape, CORNER_SHAPES)) cfg.shape = e.shape;
          else errors.push(`${k}.shape must be one of: ${CORNER_SHAPES.join(', ')}`);
        }
        if (e.color !== undefined) {
          if (isHex(e.color)) cfg.color = e.color;
          else errors.push(`${k}.color must be a hex colour`);
        }
      }
    } else {
      errors.push('corners must be an object');
    }
  }

  const gradient = parseGradient(raw.gradient, 'gradient', errors);
  if (gradient) out.gradient = gradient;

  const bg = parseGradient(raw.backgroundGradient, 'backgroundGradient', errors);
  if (bg) out.backgroundGradient = bg;

  if (raw.logoUrl !== undefined) {
    if (typeof raw.logoUrl === 'string' && raw.logoUrl.length > 0) {
      // Only https or data:image — blocks javascript: and plain http images.
      if (/^https:\/\//i.test(raw.logoUrl) || /^data:image\/png;base64,/i.test(raw.logoUrl)) {
        out.logoUrl = raw.logoUrl;
      } else {
        errors.push('logoUrl must be an https URL or a base64 PNG data URL');
      }
    } else {
      errors.push('logoUrl must be a non-empty string');
    }
  }

  if (raw.frame !== undefined) {
    const f = raw.frame;
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      errors.push('frame must be an object');
    } else {
      const fr = f as Record<string, unknown>;
      if (isOneOf(fr.style, ['none', 'plain', 'rounded'] as const)) {
        out.frame = { style: fr.style, text: undefined, color: undefined };
        if (typeof fr.text === 'string') out.frame.text = fr.text.slice(0, 120);
        if (fr.color !== undefined) {
          if (isHex(fr.color)) out.frame.color = fr.color;
          else errors.push('frame.color must be a hex colour');
        }
      } else {
        errors.push('frame.style must be one of: none, plain, rounded');
      }
    }
  }

  return { ok: errors.length === 0, value: out, errors };
}

function parseGradient(
  value: unknown,
  field: string,
  errors: string[]
): Gradient | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }
  const g = value as Record<string, unknown>;
  if (!isOneOf(g.style, ['linear', 'radial'] as const)) {
    errors.push(`${field}.style must be linear or radial`);
    return undefined;
  }
  if (!Array.isArray(g.colors) || g.colors.length < 2) {
    errors.push(`${field}.colors needs at least two stops`);
    return undefined;
  }
  const colors: GradientStop[] = [];
  for (const stop of g.colors) {
    if (!stop || typeof stop !== 'object' || Array.isArray(stop)) {
      errors.push(`${field}.colors entries must be objects`);
      return undefined;
    }
    const s = stop as Record<string, unknown>;
    if (!isHex(s.color)) {
      errors.push(`${field}.colors[].color must be a hex colour`);
      return undefined;
    }
    const offset = typeof s.offset === 'number' && Number.isFinite(s.offset) ? s.offset : 0;
    colors.push({ color: s.color, offset: clamp(offset, 0, 100) });
  }
  const out: Gradient = { style: g.style, colors };
  if (typeof g.angle === 'number' && Number.isFinite(g.angle)) out.angle = g.angle % 360;
  if (typeof g.excludeCorners === 'boolean') out.excludeCorners = g.excludeCorners;
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// Renderer mapping
// ---------------------------------------------------------------------------

/** Bitly dot pattern -> qr-code-styling `dotsOptions.type`. */
const DOT_RENDER: Record<DotPattern, string> = {
  standard: 'square',
  block: 'square',
  rounded: 'rounded',
  circle: 'dots',
  vertical: 'extra-rounded',
  blob: 'classy-rounded',
  horizontal: 'classy',
  triangle: 'classy',
  heart: 'classy',
  star: 'classy',
  diamond: 'classy'
};

/** Bitly corner shape -> qr-code-styling finder shape. */
const CORNER_RENDER: Record<CornerShape, { square: string; dot: string }> = {
  standard: { square: 'square', dot: 'square' },
  slightly_round: { square: 'classy', dot: 'square' },
  rounded: { square: 'rounded', dot: 'square' },
  extra_round: { square: 'extra-rounded', dot: 'dot' },
  leaf: { square: 'classy', dot: 'dot' },
  leaf_inner: { square: 'classy-rounded', dot: 'dot' },
  leaf_outer: { square: 'classy', dot: 'square' },
  target: { square: 'dot', dot: 'square' },
  concave: { square: 'classy-rounded', dot: 'square' }
};

export function renderDotType(pattern: DotPattern): string {
  return DOT_RENDER[pattern];
}

export function renderCornerTypes(shape: CornerShape): { square: string; dot: string } {
  return CORNER_RENDER[shape];
}