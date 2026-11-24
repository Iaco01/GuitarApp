import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, stripTags, visibleText, getAttr, classTokens, findElementEnd, removeElements } from '../src/html-text.js';

test('entities: named, decimal, hex, unknown left alone', () => {
  assert.equal(decodeEntities('a&nbsp;b &amp; c &#39;d&#x41; &foo;'), 'a b & c \'dA &foo;');
});

test('stripTags and visibleText', () => {
  assert.equal(stripTags('a<b>b</b><span class="x">c</span>'), 'abc');
  assert.equal(visibleText('<i>x&amp;y</i>'), 'x&y');
});

test('attributes and class tokens', () => {
  const tag = '<span class="a b  c" data-original-chord="F#m" data-x=\'q\'>';
  assert.equal(getAttr(tag, 'data-original-chord'), 'F#m');
  assert.equal(getAttr(tag, 'data-x'), 'q');
  assert.equal(getAttr(tag, 'missing'), null);
  assert.deepEqual(classTokens(tag), ['a', 'b', 'c']);
});

test('findElementEnd counts nesting', () => {
  const html = '<div>a<div>b</div>c</div>tail';
  assert.equal(html.slice(0, findElementEnd(html, 0, 'div')), '<div>a<div>b</div>c</div>');
  assert.equal(findElementEnd('<div>open', 0, 'div'), -1);
});

test('removeElements drops nested elements and void tags', () => {
  const html = 'x<div class="a">1<div>2</div>3</div>y<img src="q">z<bidding-unit><b>k</b></bidding-unit>w<span>keep</span>';
  assert.equal(removeElements(html, /div|img|bidding-[a-z]+/), 'xyz' + 'w<span>keep</span>');
});
