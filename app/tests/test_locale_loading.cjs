const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(failDownload = false) {
  const stored = new Map([['test_locale', 'fr']]);
  const downloads = [];
  const c = vm.createContext({
    navigator: { languages: ['bn-BD', 'en-US'] },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    document: {
      documentElement: { setAttribute() {} },
      createElement: () => ({}),
      head: { appendChild(script) {
        downloads.push(script.src);
        Promise.resolve().then(() => {
          if (failDownload) return script.onerror();
          c.WaifuI18n.register('bn', { status: 'বাংলা' });
          script.onload();
        });
      } },
    },
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../../i18n/i18n.js'), 'utf8'), c);
  const api = c.WaifuI18n;
  api.register('en', { status: 'English' });
  api.register('fr', { status: 'Français' });
  api.init({ storageKey: 'test_locale', localesBase: '/i18n/locales/' });
  return { c, api, stored, downloads };
}

test('Use device language downloads an unloaded browser locale before applying it', async () => {
  const { c, api, stored, downloads } = client();
  assert.equal(api.locale, 'fr');
  const switchDone = api.setLocale('auto');
  assert.equal(api.locale, 'fr', 'keep the translated interface while the download runs');
  assert.equal(await switchDone, 'bn');
  assert.deepEqual(downloads, ['/i18n/locales/bn.js']);
  assert.equal(api.t('status'), 'বাংলা');
  assert.equal(c.document.documentElement.lang, 'bn');
  assert.equal(api.choice, 'auto');
  assert.equal(stored.get('test_locale'), 'auto');
});

test('failed device-locale download preserves the working interface', async () => {
  const { c, api, stored, downloads } = client(true);
  assert.equal(await api.setLocale('auto'), 'fr');
  assert.deepEqual(downloads, ['/i18n/locales/bn.js']);
  assert.equal(api.t('status'), 'Français');
  assert.equal(c.document.documentElement.lang, 'fr');
  assert.equal(stored.get('test_locale'), 'auto');
});
