// These modules need the host's ownership decision before registering. In a
// busy frontend, a timeout can beat a valid response and let both owners register.
const ownership = await import('/daelab/coexistence.js').catch(() => null);

export const YIELDED_EXTENSIONS = Array.isArray(ownership?.YIELDED_EXTENSIONS)
    ? ownership.YIELDED_EXTENSIONS : [];
