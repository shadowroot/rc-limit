const key = Symbol.for('rc-limit.i18n');
const state = globalThis[key] ||= { language: 'en', translations: {}, templates: [], bindings: [] };
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function installTranslations(translations) {
  state.translations = translations;
  state.templates = Object.entries(translations).filter(([text]) => /\{\w+\}/.test(text)).map(([text, translated]) => {
    const names = [];
    const pattern = text.split(/(\{\w+\})/).map(part => {
      if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.*?)'; }
      return escape(part);
    }).join('');
    return { pattern: new RegExp('^' + pattern + '$', 's'), names, translated };
  });
}
const format = (text, values) => text.replace(/\{(\w+)\}/g, (part, name) => values[name] ?? part);
export function t(text, values = {}) {
  if (text == null) return '';
  text = String(text);
  if (state.language !== 'cs') return format(text, values);
  if (Object.hasOwn(state.translations, text)) return format(state.translations[text], values);
  for (const item of state.templates) {
    const match = item.pattern.exec(text);
    if (match) return format(item.translated, Object.fromEntries(item.names.map((name, i) => [name, match[i + 1]])));
  }
  return format(text, values);
}
export const language = () => state.language;
export function bindText(node, text) {
  state.bindings.push({ node, text });node.textContent = t(text);return node;
}
export function setLanguage(value) {
  state.language = value === 'cs' ? 'cs' : 'en';
  try { if (typeof document !== 'undefined') globalThis.localStorage?.setItem('rc-limit-language', state.language); } catch { /* Storage can be unavailable. */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = state.language;
    for (const item of state.bindings) {
      if (!item.node.isConnected) continue;
      if (item.attribute) item.node.setAttribute(item.attribute, t(item.text));
      else item.node.textContent = item.text.replace(/\S[\s\S]*\S|\S/, content => t(content));
    }
    const selector = document.getElementById('language-select');if (selector) selector.value = state.language;
    window.dispatchEvent(new Event('rc-language-change'));
  }
}
export async function initLanguage() {
  try {
    const response = await fetch(new URL('./i18n/cs.json', import.meta.url));
    if (response.ok) installTranslations(await response.json());
  } catch { /* English remains usable if the translation asset cannot load. */ }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.trim() && !node.parentElement.closest('script,style,pre,code')) state.bindings.push({ node, text: node.textContent });
  }
  for (const node of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
    for (const attribute of ['placeholder','aria-label','title']) if (node.hasAttribute(attribute)) state.bindings.push({ node, attribute, text: node.getAttribute(attribute) });
  }
  state.bindings.push({ node: document.querySelector('title'), text: document.title });
  let chosen;
  try { chosen = localStorage.getItem('rc-limit-language'); } catch { /* Use browser preference. */ }
  if (!chosen) chosen = (navigator.languages || [navigator.language]).some(item => /^cs(?:-|$)/i.test(item)) ? 'cs' : 'en';
  document.getElementById('language-select').addEventListener('change', event => setLanguage(event.target.value));
  setLanguage(chosen);
}
