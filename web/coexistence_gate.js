// Resilient three-package coexistence gate for the frontend.
//
// Resolves the set of extension names this package must yield to Creative
// Studio from the backend route. Any failure (missing route, network error,
// timeout) degrades to an empty set, so the four contested extension files
// register exactly as they did before coexistence instead of silently
// disappearing. The contested files import this module statically (relative
// path, always served from WEB_DIRECTORY) rather than importing the backend
// route directly, so a registration-order problem can never take down a whole
// extension file.
const _timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
const _module = await Promise.race([import('/daelab/coexistence.js'), _timeout]).catch(() => null);
const _names = _module && Array.isArray(_module.YIELDED_EXTENSIONS) ? _module.YIELDED_EXTENSIONS : [];

export const YIELDED_EXTENSIONS = _names;
