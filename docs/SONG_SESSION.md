# Per-song memory: SongSession (#511)

One record per song, keyed on the whole-file fingerprint from
`utils/songFingerprint.ts` (published only by `utils/songIdentity.ts`).
Stored in IndexedDB (`xasm1-song-sessions` / `sessions`, key = fingerprint) via
`utils/songSessionIdb.ts`; `createMemorySongSessionStore()` backs tests.
API: `utils/songSession.ts` (`readSongSession`, `updateSongSession`,
`recordSongPosition`; `get`/`put`/`subscribe` on the adapter).

| Field | Written by | Notes |
|---|---|---|
| `shader` | `store/shaderPrefsStore.ts` `selectShader` | restored when the fingerprint lands |
| FX override | `store/fxStore.ts` (unchanged format) | same fingerprint, own storage |
| `channelMask` | reserved for the mixer (#512) | nothing writes it yet |
| `lastPosition` | `recordSongPosition` | not wired to the transport yet; no restore |

Global preferences (last shader, favorites, theme) stay in localStorage. Do not
add per-song localStorage keys: put the field on `SongSession`.

**Legacy migration.** The old key was `xasm1_module_shader_<hex of first 16
bytes>` (`computeModuleHash`, now unused by the app). On a song's first load
the legacy shader is copied if the record has none, and the record is marked
`legacyShaderMigrated` so it never runs again. Because every XM (and many
MOD/S3M files) shared one legacy key, those songs all inherit the last shader
picked for any of them, until a new one is picked. That cannot be unpicked.

Reads/writes run on the main thread from load and pick handlers only — never in
the AudioWorklet or a requestAnimationFrame callback (`tests/songSessionGuards.test.ts`).
