/**
 * Server-side QR rendering.
 *
 * Scope, stated plainly:
 *
 * `qrcode` (already a dependency) renders a correct, scannable symbol to PNG,
 * JPEG or SVG with colour, error-correction level and quiet-zone control. That
 * is what the API image endpoints serve.
 *
 * The full design matrix — dot patterns, corner shapes, gradients, logos,
 * frames — is a *rendering* concern layered on the module grid, and is handled
 * by `qr-code-styling` in the browser designer (`components/qr-designer.tsx`).
 *
 * It is deliberately not reimplemented here. Drawing finder-pattern shapes by
 * hand over a hand-decoded module matrix means re-deriving the QR spec's
 * function-pattern, mask and format-bit regions; a subtly wrong implementation
 * produces codes that look right and fail to scan, which is worse than not
 * offering the option. A node-canvas dependency to enable it server-side was
 * judged not worth the build weight, so the split above is deliberate rather
 * than accidental.
 *
 * `renderStaticImage` additionally reproduces the documented constraint on
 * Bitly's static-code endpoint: no gradient, frame, text, logo or background
 * gradient. It is the one renderer that ignores the design payload entirely.
 */

import QRCode from 'qrcode';
import {
  type QrCustomizations,
  type ErrorCorrectionLevel
} from './customizations';

export type ImageFormat = 'png' | 'jpeg' | 'svg';

export const QR_CONTENT_TYPES: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml'
};

/** Extensions accepted by the image endpoint, per the spec's SVG/PNG support. */
export const SUPPORTED_IMAGE_FORMATS: readonly ImageFormat[] = ['png', 'jpeg', 'svg'];

export function isImageFormat(value: unknown): value is ImageFormat {
  return typeof value === 'string' && (SUPPORTED_IMAGE_FORMATS as string[]).includes(value);
}

export interface RenderOptions {
  format?: ImageFormat;
  width?: number;
  /** Quiet zone in modules. The QR spec minimum is 4. */
  margin?: number;
  dark?: string;
  light?: string;
  errorCorrection?: ErrorCorrectionLevel;
}

/**
 * Render a scannable QR symbol.
 *
 * Colours are passed through as given. Callers are expected to have already run
 * `parseCustomizations`, which is what constrains them to the documented hex
 * forms — this function does not re-validate.
 */
export async function renderQrImage(
  content: string,
  options: RenderOptions = {}
): Promise<Buffer> {
  const format = options.format ?? 'png';
  const shared = {
    width: options.width ?? 512,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrection ?? 'M'
  };
  const color = {
    dark: options.dark ?? '#000000ff',
    light: options.light ?? '#ffffffff'
  };

  if (format === 'svg') {
    // `qrcode` splits its API in two: `toBuffer` is raster, `toString` is
    // vector. Passing `type: 'svg'` to `toBuffer` is not supported.
    const svg = await QRCode.toString(content, { ...shared, type: 'svg', color });
    return Buffer.from(svg, 'utf8');
  }

  const png = await QRCode.toBuffer(content, { ...shared, type: 'png', color });

  if (format === 'png') return png;

  // JPEG: `qrcode` accepts `type: 'jpeg'` but silently ignores it and returns
  // PNG bytes, which would be served as `image/jpeg` and fail to open. Verified
  // rather than assumed, so encode with sharp instead.
  const { default: sharp } = await import('sharp');
  return sharp(png)
    .flatten({ background: parseHexToRgba(options.light ?? '#ffffff') })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** `#rgb`, `#rrggbb` and `#rrggbbaa` -> `{r,g,b,alpha}`. */
function parseHexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (!/^[0-9a-f]{8}$/i.test(h)) {
    return { r: 255, g: 255, b: 255, alpha: 1 };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    alpha: parseInt(h.slice(6, 8), 16) / 255
  };
}

/**
 * The static-code renderer.
 *
 * Bitly documents that the static endpoint supports basic colour and pattern
 * customisation but explicitly not gradient, background gradient, frame, text
 * or logo. Rather than accept those fields and ignore them, this drops them and
 * reports the downgrade so the caller can surface it.
 */
export async function renderStaticImage(
  content: string,
  customizations: QrCustomizations,
  options: Omit<RenderOptions, 'dark' | 'light'> = {}
): Promise<{ buffer: Buffer; downgraded: string[] }> {
  const downgraded: string[] = [];
  if (customizations.gradient) downgraded.push('gradient');
  if (customizations.backgroundGradient) downgraded.push('backgroundGradient');
  if (customizations.logoUrl) downgraded.push('logoUrl');
  if (customizations.frame && customizations.frame.style !== 'none') downgraded.push('frame');

  const buffer = await renderQrImage(content, {
    ...options,
    dark: customizations.dotPatternColor,
    light: customizations.backgroundColor,
    errorCorrection: customizations.errorCorrection
  });
  return { buffer, downgraded };
}

/** Header value for a download disposition, including the extension. */
export function contentDisposition(format: ImageFormat, filename = 'qr'): string {
  return `inline; filename="${filename}.${format}"`;
}