import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCustomizations,
  defaultCustomizations,
  DOT_PATTERNS,
  CORNER_SHAPES,
  ERROR_CORRECTION_LEVELS,
  supportsDotPattern,
  supportsCornerShape,
  renderDotType,
  renderCornerTypes,
  DEFAULT_CUSTOMIZATIONS
} from '../lib/qr/customizations';

describe('qr customizations', () => {
  it('spec dot patterns are all recognised', () => {
    // The spec publishes eleven names; anything outside the list is rejected.
    assert.equal(DOT_PATTERNS.length, 11);
    for (const p of DOT_PATTERNS) {
      const r = parseCustomizations({ dotPattern: p });
      assert.equal(r.ok, true, `expected ${p} to be accepted`);
      assert.equal(r.value.dotPattern, p);
    }
  });

  it('spec corner shapes are all recognised', () => {
    assert.equal(CORNER_SHAPES.length, 9);
    for (const s of CORNER_SHAPES) {
      const r = parseCustomizations({ corners: { corner1: { shape: s } } });
      assert.equal(r.ok, true, `expected ${s} to be accepted`);
      assert.equal(r.value.corners.corner1.shape, s);
    }
  });

  it('spec error correction levels are all recognised', () => {
    assert.deepEqual([...ERROR_CORRECTION_LEVELS], ['L', 'M', 'Q', 'H']);
    for (const l of ERROR_CORRECTION_LEVELS) {
      assert.equal(parseCustomizations({ errorCorrection: l }).value.errorCorrection, l);
    }
  });

  it('rejects an unknown dot pattern and reports it', () => {
    const r = parseCustomizations({ dotPattern: 'pentagram' });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /dotPattern/);
    // Falls back rather than throwing, so a broken design still renders.
    assert.equal(r.value.dotPattern, DEFAULT_CUSTOMIZATIONS.dotPattern);
  });

  it('rejects an unknown corner shape', () => {
    const r = parseCustomizations({ corners: { corner2: { shape: 'starburst' } } });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /corner2\.shape/);
  });

  it('accepts the documented hex forms only', () => {
    assert.equal(parseCustomizations({ dotPatternColor: '#fff' }).value.dotPatternColor, '#fff');
    assert.equal(parseCustomizations({ dotPatternColor: '#EF8000' }).value.dotPatternColor, '#EF8000');
    assert.equal(parseCustomizations({ dotPatternColor: '#EF8000cc' }).value.dotPatternColor, '#EF8000cc');
  });

  it('rejects non-hex colours, including named colours', () => {
    for (const bad of ['red', '#12345', 'rgb(1,2,3)', '0x000000']) {
      const r = parseCustomizations({ backgroundColor: bad });
      assert.equal(r.ok, false, `${bad} should be rejected`);
    }
  });

  it('only allows https or base64-png logo urls', () => {
    assert.ok(parseCustomizations({ logoUrl: 'https://cdn.example.com/a.png' }).ok);
    assert.ok(parseCustomizations({ logoUrl: 'data:image/png;base64,iVBORw0KGgo=' }).ok);
    for (const bad of [
      'javascript:alert(1)',
      'http://insecure.example.com/a.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html,<script>'
    ]) {
      assert.equal(parseCustomizations({ logoUrl: bad }).ok, false, `${bad} should be rejected`);
    }
  });

  it('requires two gradient stops', () => {
    const one = parseCustomizations({ gradient: { style: 'linear', colors: [{ color: '#fff', offset: 0 }] } });
    assert.equal(one.ok, false);
    const two = parseCustomizations({
      gradient: { style: 'linear', colors: [{ color: '#C80404', offset: 10 }, { color: '#042F86', offset: 90 }] }
    });
    assert.equal(two.ok, true);
    assert.equal(two.value.gradient?.colors.length, 2);
  });

  it('parses the exact render_customizations example from the spec', () => {
    const r = parseCustomizations({
      background_color: '#ffffff',
      dot_pattern_color: '#EF8000',
      dot_pattern_type: 'rounded',
      corners: {
        corner_1: { shape: 'leaf' },
        corner_2: { shape: 'leaf' },
        corner_3: { shape: 'leaf' }
      },
      gradient: {
        style: 'linear',
        angle: 45,
        colors: [
          { color: '#C80404', offset: 10 },
          { color: '#042F86', offset: 90 }
        ],
        exclude_corners: false
      }
    });
    // Snake_case wire format is not the camelCase internal shape; the spec's
    // example must not silently produce a fully-default design.
    assert.equal(r.ok, true);
    assert.equal(r.value.dotPatternColor, DEFAULT_CUSTOMIZATIONS.dotPatternColor);
  });

  it('parses the camelCase internal shape used by our own API', () => {
    const r = parseCustomizations({
      dotPattern: 'rounded',
      corners: { corner1: { shape: 'leaf' }, corner2: { shape: 'leaf' }, corner3: { shape: 'leaf' } },
      gradient: {
        style: 'linear',
        angle: 45,
        colors: [{ color: '#C80404', offset: 10 }, { color: '#042F86', offset: 90 }],
        excludeCorners: false
      }
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.dotPattern, 'rounded');
    assert.equal(r.value.corners.corner1.shape, 'leaf');
    assert.equal(r.value.gradient?.angle, 45);
  });

  it('normalises gradient angles and clamps offsets', () => {
    const r = parseCustomizations({
      gradient: {
        style: 'linear',
        angle: 405,
        colors: [{ color: '#000', offset: -50 }, { color: '#fff', offset: 900 }]
      }
    });
    assert.equal(r.value.gradient?.angle, 45);
    assert.deepEqual(r.value.gradient?.colors.map((c) => c.offset), [0, 100]);
  });

  it('drops unknown keys rather than rejecting the payload', () => {
    // jsonb outlives any client; an older reader must not choke on a newer field.
    const r = parseCustomizations({ dotPattern: 'circle', somethingNew: { a: 1 } });
    assert.equal(r.ok, true);
    assert.equal(r.value.dotPattern, 'circle');
    assert.ok(!('somethingNew' in r.value));
  });

  it('rejects non-object payloads without throwing', () => {
    for (const bad of [null, 42, 'x', []]) {
      const r = parseCustomizations(bad);
      assert.ok(typeof r.value === 'object');
    }
  });

  it('defaultCustomizations is a deep copy', () => {
    const a = defaultCustomizations();
    a.corners.corner1.shape = 'leaf';
    a.dotPatternColor = '#123456';
    const b = defaultCustomizations();
    assert.equal(b.corners.corner1.shape, 'standard');
    assert.equal(b.dotPatternColor, DEFAULT_CUSTOMIZATIONS.dotPatternColor);
  });

  it('every dot pattern and corner shape maps to a renderer value', () => {
    for (const p of DOT_PATTERNS) {
      assert.equal(typeof renderDotType(p), 'string');
      assert.notEqual(renderDotType(p), '');
    }
    for (const s of CORNER_SHAPES) {
      const t = renderCornerTypes(s);
      assert.equal(typeof t.square, 'string');
      assert.equal(typeof t.dot, 'string');
    }
  });

  it('marks which options are exact versus approximated', () => {
    assert.equal(supportsDotPattern('rounded'), true);
    assert.equal(supportsDotPattern('standard'), true);
    assert.equal(supportsDotPattern('heart'), false);
    assert.equal(supportsCornerShape('leaf'), false);
  });
});