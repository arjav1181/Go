declare module 'qrcode' {
  export function toBuffer(text: string, options?: unknown): Promise<Buffer>;
  export function toString(text: string, options?: unknown): Promise<string>;
  export function toDataURL(text: string, options?: unknown): Promise<string>;
}
