const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'Asia/Ho_Chi_Minh';
const source = fs.readFileSync(path.join(__dirname, '..', 'baocao.user.js'), 'utf8');
const instrumented = source.replace('  APP.init();', `
  globalThis.scriptTest = { AUTH, DATA, UTILS, InitialLoader, UI, CONSTANTS,
    getState: () => AUTH_STATE, setState: value => { AUTH_STATE = value; } };`);
assert.notEqual(instrumented, source, 'The test harness must replace app startup');
const now = Date.parse('2026-10-24T03:00:00Z');
const user = '123456 - Nhân viên kiểm thử';
const cacheKey = 'tgdd_auth_cache_v1';
const plain = value => JSON.parse(JSON.stringify(value));
const goodCache = overrides => ({ user, isAuthorized: true, expireDays: 5, timestamp: now, ...overrides });

function harness(options = {}) {
  const requests = [], registrations = [], timers = [];
  const values = new Map(Object.entries(options.values || {}));
  const local = new Map(Object.entries(options.local || {}));
  const document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
  const window = { location: { href: 'https://baocao.dienmayxanh.com/dashboard/revenue-consolidated', pathname: '/dashboard/revenue-consolidated' }, addEventListener() {} };
  const sandbox = {
    window, document, console,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    GM_getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    GM_setValue: (key, value) => values.set(key, value), GM_deleteValue: key => values.delete(key), GM_addStyle() {},
    GM_xmlhttpRequest: request => { if (options.throwRequest) throw new Error('offline'); requests.push(request); return { abort() {} }; },
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, delay) => timers.push({ fn, delay }), clearTimeout() {},
    setInterval: (fn, delay) => timers.push({ fn, delay }), clearInterval() {}
  };
  vm.runInNewContext(instrumented, sandbox, { timeout: 2000, filename: 'baocao.user.js' });
  const api = sandbox.scriptTest;
  api.AUTH.getUserStringFromDOM = () => options.user === undefined ? user : options.user;
  api.AUTH.setupWebsiteHeader = () => {};
  api.AUTH.reportVersionToCloud = () => {};
  api.AUTH.autoRegisterUserToSheet = (id, name) => registrations.push({ id, name });
  api.UTILS.isHomePage = () => options.home === true;
  return { ...api, requests, registrations, timers, values, document, window };
}

function authCSV(overrides = {}) {
  const row = Array(13).fill('');
  row[0] = overrides.id ?? '123456'; row[1] = overrides.user ?? user;
  row[8] = overrides.days ?? '5'; row[12] = overrides.key ?? 'TEST-KEY-1234';
  const escape = value => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  return Array.from({ length: 13 }, (_, i) => 'Column ' + i).join(',') + '\r\n' + row.map(escape).join(',');
}

function verify(h, responseText = authCSV()) {
  let result, calls = 0;
  h.AUTH.check(state => { result = plain(state); calls++; });
  if (h.requests.length) h.requests[0].onload({ status: 200, responseText });
  return { get result() { return result; }, get calls() { return calls; } };
}

test('a matching active license permits use', () => {
  const h = harness(); const outcome = verify(h);
  assert.equal(outcome.result.isAuthorized, true);
  assert.equal(outcome.calls, 1);
  assert.equal(h.values.get(cacheKey).user, user);
});

test('an expired license is denied', () => assert.equal(verify(harness(), authCSV({ days: '-1' })).result.isAuthorized, false));
test('a short activation key is denied', () => assert.equal(verify(harness(), authCSV({ key: 'short' })).result.isAuthorized, false));
test('the last valid day is accepted', () => assert.equal(verify(harness(), authCSV({ days: '0' })).result.isAuthorized, true));
test('a blank expiry retains the existing unlimited-expiry rule', () => assert.equal(verify(harness(), authCSV({ days: '' })).result.isAuthorized, true));

test('an unknown account is registered without granting access', () => {
  const h = harness(); const outcome = verify(h, authCSV({ id: '987654', user: '987654 - Khác' }));
  assert.equal(outcome.result.isAuthorized, false);
  assert.deepEqual(h.registrations, [{ id: '123456', name: user }]);
});

test('quoted commas, escaped quotes, multiline fields, BOM and CRLF preserve license columns', () => {
  const h = harness();
  const csv = '\uFEFF' + authCSV({ user: '123456 - Tên, có "ngoặc"\nvà dòng mới', days: '10' });
  assert.equal(verify(h, csv).result.isAuthorized, true);
});

test('recent cache is reused away from home', () => {
  const h = harness({ values: { [cacheKey]: goodCache() } }); const outcome = verify(h);
  assert.equal(outcome.result.isAuthorized, true); assert.equal(h.requests.length, 0);
});

test('home refresh detects revocation even with a recent positive cache', () => {
  const h = harness({ home: true, values: { [cacheKey]: goodCache() } });
  assert.equal(verify(h, authCSV({ days: '-1' })).result.isAuthorized, false);
  assert.equal(h.requests.length, 1);
});

test('cached expiry decreases at the next local day', () => {
  const h = harness({ values: { [cacheKey]: goodCache({ expireDays: 0, timestamp: now - 86400000 }) } });
  const state = verify(h).result;
  assert.equal(state.expireDays, -1); assert.equal(state.isAuthorized, false);
});

test('network errors use a recent cache without renewing its timestamp', () => {
  const saved = goodCache({ timestamp: now - 3600000 });
  const h = harness({ home: true, values: { [cacheKey]: saved } }); let result;
  h.AUTH.check(state => result = state); h.requests[0].onerror();
  assert.equal(result.isAuthorized, true); assert.equal(h.values.get(cacheKey).timestamp, saved.timestamp);
});

test('network errors never restore cache older than three days', () => {
  const h = harness({ values: { [cacheKey]: goodCache({ timestamp: now - 3 * 86400000 }) } }); let result;
  h.AUTH.check(state => result = state); h.requests[0].ontimeout(); assert.equal(result.isAuthorized, false);
});

test('switching accounts clears active config and rejects the other account cache', () => {
  const h = harness({ user: '987654 - Khác', values: { [cacheKey]: goodCache() } });
  h.window.tgdd_active_user_config = { cluster: 'Previous account' }; let result;
  h.AUTH.check(state => result = state); h.requests[0].onerror();
  assert.equal(result.isAuthorized, false); assert.equal(h.window.tgdd_active_user_config, null);
  assert.equal(h.AUTH.restoreCachedAuth(), false);
});

test('corrupt GM cache falls back to valid local cache', () => {
  const h = harness({ values: { [cacheKey]: '{bad json' }, local: { [cacheKey]: JSON.stringify(goodCache()) } });
  assert.equal(verify(h).result.isAuthorized, true);
});

test('incomplete cache cannot silently grant access', () => {
  const h = harness({ values: { [cacheKey]: { user, timestamp: now } } }); let result;
  h.AUTH.check(state => result = state); h.requests[0].onerror(); assert.equal(result.isAuthorized, false);
});

test('future-dated cache is rejected', () => {
  const h = harness({ values: { [cacheKey]: goodCache({ timestamp: now + 3600000 }) } }); let result;
  h.AUTH.check(state => result = state); h.requests[0].onerror(); assert.equal(result.isAuthorized, false);
});

for (const responseText of ['<!DOCTYPE HTML><HTML>Sign in</HTML>', 'unexpected response', 'a,b,c\n"unterminated']) {
  test('invalid auth response preserves a recent cache: ' + responseText.slice(0, 22), () => {
    const h = harness({ home: true, values: { [cacheKey]: goodCache() } });
    assert.equal(verify(h, responseText).result.isAuthorized, true);
  });
}

test('repeated request completion events invoke the callback once', () => {
  const h = harness(); let calls = 0;
  h.AUTH.check(() => calls++); h.requests[0].onerror(); h.requests[0].ontimeout();
  h.requests[0].onload({ status: 200, responseText: authCSV() });
  assert.equal(calls, 1);
  assert.equal(h.values.has(cacheKey), false);
});

test('synchronous request failure returns a denied result', () => {
  const h = harness({ throwRequest: true }); let result;
  assert.doesNotThrow(() => h.AUTH.check(state => result = state)); assert.equal(result.isAuthorized, false);
});

test('a missing user produces a checked, denied result', () => {
  const h = harness({ user: '' }); const state = verify(h).result;
  assert.equal(state.checked, true); assert.equal(state.isAuthorized, false); assert.equal(h.requests.length, 0);
});

for (const response of [
  { status: 403, responseText: '{"status":"success"}' },
  { status: 200, responseText: '<HTML>Sign in</HTML>' },
  { status: 200, responseText: '{"status":"error"}' }
]) {
  test('cloud save requires confirmed server success: ' + response.status + '/' + response.responseText, () => {
    const h = harness(); h.DATA.getStandardUserName = callback => callback(user); let result;
    h.DATA.saveCloudConfig({ cluster: 'Test' }, value => result = value);
    h.requests[0].onload(response); assert.equal(result.status, 'error');
  });
}

test('cloud save accepts a successful JSON response', () => {
  const h = harness(); h.DATA.getStandardUserName = callback => callback(user); let result;
  h.DATA.saveCloudConfig({}, value => result = value);
  h.requests[0].onload({ status: 200, responseText: '{"status":"success"}' });
  assert.equal(result.status, 'success');
});

test('cloud save timeout reports failure', () => {
  const h = harness(); h.DATA.getStandardUserName = callback => callback(user); let result;
  h.DATA.saveCloudConfig({}, value => result = value); h.requests[0].ontimeout(); assert.equal(result.status, 'error');
});

test('cloud load finishes with null when no account is available', () => {
  const h = harness(); h.DATA.getStandardUserName = callback => callback(null); let result = 'pending';
  h.DATA.loadCloudConfig(value => result = value); assert.equal(result, null);
});

test('standard account lookup times out without blocking a save', () => {
  const h = harness(); let result;
  h.DATA.getStandardUserName(value => result = value);
  h.requests[0].ontimeout(); assert.equal(result, user);
});

test('standard account lookup preserves quoted multiline names', () => {
  const h = harness(); let result;
  h.DATA.getStandardUserName(value => result = value);
  const standard = '123456 - Tên, có "ngoặc"\nvà dòng mới';
  h.requests[0].onload({ status: 200, responseText: authCSV({ user: standard }) });
  assert.equal(result, standard);
});

test('revenue values stay exact after license rejection, including real-revenue mode', () => {
  const h = harness(); verify(h, authCSV({ days: '-1' }));
  const cells = ['Tổng', '1', '1000', '2000', '50%', '', '', '1800', '', '300', '', '70%'].map(text => ({ innerText: text, textContent: text }));
  const table = { querySelector: () => ({ querySelectorAll: () => cells }), querySelectorAll: () => [] };
  h.document.querySelector = () => table;
  assert.deepEqual(plain(h.DATA.scrapeRevenueTableDMX({}, {}).total), { t: 2000, r: 1000, dtlk: 0, tg: 30, dk: 90, dtqd_dk: 1800, tlpvtc: 70 });
  assert.equal(h.DATA.scrapeRevenueTableDMX({}, {}, true).total.dt_thuc, 1000);
});

test('competition quantities and percentages stay exact after license rejection', () => {
  const h = harness(); verify(h, authCSV({ days: '-1' }));
  const cell = text => ({ innerText: text, getAttribute: () => null });
  const cells = ['Tổng', '100', '200', '50%', '60%'].map(cell);
  const row = { classList: { contains: () => false }, querySelectorAll: () => cells, querySelector: () => null, getAttribute: () => '__total__' };
  const table = { querySelector: selector => cell(selector.includes('first-child') ? 'Gia dụng' : 'SỐ LƯỢNG'), querySelectorAll: () => [row] };
  h.document.querySelectorAll = () => [table];
  const result = h.DATA.scrapeThiDuaTablesDMX([{ full: 'Gia dụng', short: 'GD', type: 'soluong' }], {}, {});
  assert.deepEqual(plain(result.GD.total), { t: 200, r: 100, p: 50, pd: 60 });
});
