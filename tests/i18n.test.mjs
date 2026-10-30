import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installTranslations, setLanguage, t } from '../web/i18n.mjs';
const catalog = JSON.parse(await readFile(new URL('../web/i18n/cs.json', import.meta.url)));
installTranslations(catalog);
setLanguage('cs');
assert.equal(t('ACTIVE'), 'AKTIVNÍ');
assert.equal(t('Revision 4 · viewing mapping 2'), 'Revize 4 · zobrazené přiřazení 2');
assert.equal(t('Invalid integer: input_pin'), 'Neplatné celé číslo: input_pin');
assert.equal(t('Board rejected command: invalid_config'), 'Deska odmítla příkaz: invalid_config');
assert.equal(t('Boat port ESC · pico · ID 001122ABC123'), 'Boat port ESC · pico · ID 001122ABC123');
assert.equal(t('untranslated-device-value'), 'untranslated-device-value');
for (const [source,translated] of Object.entries(catalog)) {
  assert.equal(typeof translated, 'string');
  assert.deepEqual([...source.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(), [...translated.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(), source);
}
setLanguage('en');
assert.equal(t('ACTIVE'), 'ACTIVE');
assert.equal(t('Invalid integer: {field}', {field: 'input_pin'}), 'Invalid integer: input_pin');
console.log('English/Czech translations and dynamic placeholders passed.');
