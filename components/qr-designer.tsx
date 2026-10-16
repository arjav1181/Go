'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCodeStyling from 'qr-code-styling';
import {
  DOT_PATTERNS,
  CORNER_SHAPES,
  ERROR_CORRECTION_LEVELS,
  supportsDotPattern,
  supportsCornerShape,
  type QrCustomizations,
  type DotPattern,
  type CornerShape,
  type ErrorCorrectionLevel,
  parseCustomizations
} from '@/lib/qr/customizations';

/**
 * QR designer.
 *
 * Renders through `qr-code-styling` in the browser rather than the server-side
 * renderer, because dot-pattern and corner-shape styling is a layer over the
 * module grid — see lib/qr/render.ts for why that is not reimplemented
 * server-side.
 *
 * Two honest limits, both surfaced in the UI rather than hidden:
 *
 *   - Options the renderer approximates are labelled "(approximate)".
 *   - Only corner 1's shape is applied. The library takes one
 *     cornerSquareOptions/cornerDotOptions pair for the whole symbol and offers
 *     no per-corner override, so all three corners render identically. Bitly
 *     allows them to differ; we store all three but do not pretend to draw them.
 */

export interface QrDesignerProps {
  content: string;
  value: QrCustomizations;
  onChange: (next: QrCustomizations) => void;
  size?: number;
}

type DownloadFormat = 'png' | 'jpeg' | 'svg' | 'webp';

export function QrDesigner({ content, value, onChange, size = 260 }: QrDesignerProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const instance = useRef<QRCodeStyling | null>(null);
  const [format, setFormat] = useState<DownloadFormat>('png');

  // Corner 1 drives the rendering; corners 2 and 3 are stored but not drawn.
  const activeCorner = value.corners.corner1.shape;

  const options = useMemo(
    () => ({
      width: size,
      height: size,
      type: 'canvas' as const,
      data: content,
      margin: 0,
      qrOptions: { errorCorrectionLevel: value.errorCorrection },
      image: value.logoUrl || undefined,
      dotsOptions: { color: value.dotPatternColor, type: mapDot(value.dotPattern) },
      backgroundOptions: {
        color: value.backgroundColor,
        ...(value.backgroundGradient
          ? {
              gradients: [
                {
                  type: mapGradient(value.backgroundGradient.style),
                  rotation: value.backgroundGradient.angle ?? 0,
                  colorStops: value.backgroundGradient.colors.map((c) => ({
                    offset: c.offset,
                    color: c.color
                  }))
                }
              ]
            }
          : {})
      },
      imageOptions: {
        hideBackgroundDots: true,
        imageSize: 0.36,
        margin: 4,
        crossOrigin: 'anonymous' as const
      },
      cornerSquareOptions: {
        type: mapCornerSquare(activeCorner),
        color: value.corners.corner1.color ?? value.dotPatternColor
      },
      cornerDotOptions: {
        type: mapCornerDot(activeCorner),
        color: value.corners.corner1.color ?? value.dotPatternColor
      }
    }),
    [content, value, size, activeCorner]
  );

  useEffect(() => {
    if (!holder.current) return;
    if (!instance.current) {
      instance.current = new QRCodeStyling(options);
      instance.current.append(holder.current);
    } else {
      instance.current.update(options);
    }
  }, [options]);

  // Forward gradient is applied by the library only at construction, so it is
  // reported rather than silently dropped.
  const gradientUnsupported = Boolean(value.gradient);

  const patch = (partial: Partial<QrCustomizations>) => {
    onChange(parseCustomizations({ ...value, ...partial }).value);
  };

  const setCorner = (which: 1 | 2 | 3, shape: CornerShape) => {
    const key = (`corner${which}`) as 'corner1' | 'corner2' | 'corner3';
    onChange(
      parseCustomizations({
        ...value,
        corners: { ...value.corners, [key]: { ...value.corners[key], shape } }
      }).value
    );
  };

  async function download() {
    const node = instance.current;
    if (!node) return;
    try {
      const blob = await node.getRawData(format);
      if (blob instanceof Blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qr.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      /* best effort: the preview above already reflects the design */
    }
  }

  return (
    <div className="qr-designer card card-pad">
      <div className="card card-pad">
        <div ref={holder} />
      </div>

      <div className="qr-designer-controls">
        <Field label="Dot pattern">
          <select
            className="select"
            value={value.dotPattern}
            onChange={(e) => patch({ dotPattern: e.target.value as DotPattern })}
          >
            {DOT_PATTERNS.map((p) => (
              <option key={p} value={p}>
                {p}
                {supportsDotPattern(p) ? '' : ' (approximate)'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Dot colour">
          <input
            className="input"
            type="color"
            value={normaliseColor(value.dotPatternColor)}
            onChange={(e) => patch({ dotPatternColor: e.target.value })}
          />
        </Field>

        <Field label="Background">
          <input
            className="input"
            type="color"
            value={normaliseColor(value.backgroundColor)}
            onChange={(e) => patch({ backgroundColor: e.target.value })}
          />
        </Field>

        <Field label="Error correction">
          <select
            className="select"
            value={value.errorCorrection}
            onChange={(e) => patch({ errorCorrection: e.target.value as ErrorCorrectionLevel })}
          >
            {ERROR_CORRECTION_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Corner shape (applies to all three)">
          <select
            className="select"
            value={activeCorner}
            onChange={(e) => setCorner(1, e.target.value as CornerShape)}
          >
            {CORNER_SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
                {supportsCornerShape(s) ? '' : ' (approximate)'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Logo PNG URL">
          <input
            className="input"
            type="url"
            placeholder="https://…/logo.png"
            value={value.logoUrl ?? ''}
            onChange={(e) => patch({ logoUrl: e.target.value || undefined })}
          />
        </Field>

        <Field label="Download as">
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value as DownloadFormat)}>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="svg">SVG</option>
            <option value="webp">WebP</option>
          </select>
        </Field>

        <button type="button" className="btn btn-primary" onClick={download}>
          Download
        </button>

        {gradientUnsupported ? (
          <p className="qr-note">
            Foreground gradients are stored but not drawn by the current renderer.
            Background gradients render.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="label">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** `<input type=color>` needs #rrggbb; short and alpha forms are not accepted. */
function normaliseColor(hex: string): string {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return '000000';
  return h.toLowerCase();
}

type DotType = 'dots' | 'rounded' | 'classy' | 'classy-rounded' | 'square' | 'extra-rounded';

/** Mirrors DOT_RENDER in lib/qr/customizations.ts. */
function mapDot(pattern: DotPattern): DotType {
  switch (pattern) {
    case 'rounded':
      return 'rounded';
    case 'circle':
      return 'dots';
    case 'vertical':
      return 'extra-rounded';
    case 'blob':
      return 'classy-rounded';
    case 'horizontal':
    case 'triangle':
    case 'heart':
    case 'star':
    case 'diamond':
      return 'classy';
    default:
      return 'square';
  }
}

/** Mirrors CORNER_RENDER in lib/qr/customizations.ts. */
function mapCornerSquare(shape: CornerShape): DotType | 'dot' {
  switch (shape) {
    case 'slightly_round':
    case 'leaf':
    case 'leaf_outer':
      return 'classy';
    case 'rounded':
      return 'rounded';
    case 'extra_round':
      return 'extra-rounded';
    case 'leaf_inner':
    case 'concave':
      return 'classy-rounded';
    case 'target':
      return 'dot';
    default:
      return 'square';
  }
}

function mapCornerDot(shape: CornerShape): 'dot' | 'square' {
  return shape === 'extra_round' || shape === 'leaf' || shape === 'leaf_inner' ? 'dot' : 'square';
}

function mapGradient(style: 'linear' | 'radial'): 'linear' | 'radial' {
  return style;
}