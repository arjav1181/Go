import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReferrerHost, isReservedReferrer, RESERVED_REFERRERS } from '../lib/analytics/device-category';

describe('reserved referrers', () => {
  it('cannot be forged from a visitor-controlled Referer header', () => {
    // A hostile page controls this header outright. If either label could come
    // back from parseReferrerHost, anyone could mint scan or page-click
    // attribution against a link they do not own.
    for (const label of RESERVED_REFERRERS) {
      assert.equal(parseReferrerHost(label), 'unknown', label);
      assert.equal(parseReferrerHost(`https://${label}/x`), 'unknown', label);
    }
  });

  it('keeps ordinary referrers intact', () => {
    assert.equal(parseReferrerHost('https://news.example.com/a'), 'news.example.com');
    assert.equal(parseReferrerHost('https://WWW.Example.com/'), 'www.example.com');
    assert.equal(parseReferrerHost(null), 'direct');
    assert.equal(parseReferrerHost('not a url'), 'unknown');
  });

  it('recognises the reserved labels', () => {
    assert.equal(isReservedReferrer('Bitly QR Code'), true);
    assert.equal(isReservedReferrer('Bitly Link-in-bio'), true);
    assert.equal(isReservedReferrer('example.com'), false);
  });
});
