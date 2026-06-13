/**
 * Session-scoped memory of one-shot UI animations that have already played, so
 * they do NOT replay when a component remounts — e.g. switching chat <-> full
 * map, or navigating page <-> page. Cleared on a full page refresh (the module
 * re-initialises), which is the one time replaying is wanted.
 */

/** Assistant message ids whose typewriter reveal + entrance has already played. */
export const shownMessages = new Set<string>()

/** Map marker-set keys whose cinematic camera glide has already played. */
export const cinematicMapKeys = new Set<string>()
