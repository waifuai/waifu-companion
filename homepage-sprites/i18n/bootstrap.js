/**
 * bootstrap.js — picks the interface language before the first paint.
 *
 * Runs in <head> right after i18n.js and before locales/en.js. It:
 *   1. tells the runtime which storage key this page uses (the embed keeps its
 *      own key so a language picked inside a Player Card cannot leak into the
 *      full app, and vice versa);
 *   2. detects the locale (saved choice -> the browser's own languages ->
 *      English) and sets <html lang dir> immediately, so Arabic and Persian
 *      never paint left-to-right for a frame;
 *   3. synchronously pulls in the one matched dictionary with document.write,
 *      so a non-English visitor paints in their language with no flash of
 *      English. English visitors load only en.js.
 *
 * The document.write is a single small, cached, same-origin file on the parse
 * path; every other dictionary loads on demand later (I18n.ensure).
 */
(function (root) {
  'use strict';
  var I18n = root.WaifuI18n;
  var doc = root.document;
  if (!I18n || !doc) return;

  var base = '/homepage-sprites/i18n/locales/';
  try {
    I18n.init({
      storageKey: 'ws_locale',
      localesBase: base,
    });
  } catch (e) {
    return; // a broken runtime must never block the page
  }

  // Only a dictionary that differs from the English fallback needs to ride
  // along with the parse; <html lang dir> is already applied above.
  var code = I18n.locale;
  if (code && code !== I18n.FALLBACK && doc.readyState === 'loading') {
    doc.write('<script src="' + base + code + '.js"><\/script>');
  }
})(typeof window !== 'undefined' ? window : globalThis);
