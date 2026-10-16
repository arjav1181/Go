/**
 * Teach the CommonJS resolver about the `@/` path alias.
 *
 * `tsconfig.json` maps `@/*` to the repo root and TypeScript honours that when
 * it compiles, but the emitted JavaScript keeps the bare `@/...` specifier and
 * CommonJS's resolver has no idea it means anything. Any test importing a module
 * that reaches `@/` therefore fails with MODULE_NOT_FOUND.
 *
 * That came up three times, each time "fixed" by splitting a file in two purely
 * to dodge the import. This fixes the class of problem instead.
 *
 * Patching Module._resolveFilename is the way to do it for CommonJS. An ESM
 * `resolve` hook does not apply here because tsconfig.test.json emits CommonJS,
 * which goes through cjs/loader and never consults the ESM hook chain.
 */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const original = Module._resolveFilename;

function candidatesFor(base) {
  // Compiled output first. At test time the tests run from .test-dist, so the
  // `@/` target must resolve there rather than to the TypeScript source —
  // handing Node a .ts file makes it try to parse type syntax as JavaScript.
  const roots = [DIST, ROOT];
  const suffixes = ['.js', '.ts', '', path.join('', 'index.js'), path.join('', 'index.ts')];
  const out = [];
  for (const root of roots) {
    for (const suffix of suffixes) {
      out.push(path.join(root, base + suffix));
    }
  }
  return out;
}

Module._resolveFilename = function resolveAlias(request, ...rest) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const candidates = candidatesFor(request.slice(2));
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        try {
          return original.call(this, candidate, ...rest);
        } catch {
          // Fall through and try the next candidate shape.
        }
      }
    }
  }
  return original.call(this, request, ...rest);
};
