'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Browser } = require('./runtime.cjs');
test('only a recent user gesture in this page and dedicated context may display a new page', () => {
  const b = new Browser('.', 'http://127.0.0.1:54321');
  b.target = 'parent'; b.context = 'owned-context'; b.pages = [{target:'parent',sid:'parent-session'}];
  b.gesture = { target: 'parent', at: 1000 };
  const p = {targetId:'child',type:'page',openerId:'parent',browserContextId:'owned-context',url:'https://example.test/'};
  assert.equal(typeof b.canFollowPopup, 'function');
  assert.equal(b.canFollowPopup(p,1500),true);
  assert.equal(b.canFollowPopup({...p,url:'about:blank'},1500),true);
  assert.equal(b.canFollowPopup({...p,browserContextId:'foreign'},1500),false);
  assert.equal(b.canFollowPopup({...p,openerId:'foreign'},1500),false);
  assert.equal(b.canFollowPopup({...p,url:'file:///private'},1500),false);
  assert.equal(b.canFollowPopup({...p,url:'https://name:password@example.test'},1500),false);
  assert.equal(b.canFollowPopup(p,5000),false);
  b.gesture=null; assert.equal(b.canFollowPopup(p,1500),false);
});
