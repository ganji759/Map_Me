// Record HeroAgentLive's captured sequence into frames for ffmpeg assembly.
//
// RENDER-WAIT (the whole point — kills the "steely bread" blur):
//   • The component runs a WARMUP dry-run flying the full camera path so every
//     tile caches, then parks at the establishing shot and waits on __heroGo.
//   • This recorder starts the CDP screencast EARLY and watches frame-to-frame
//     JPEG size. Photoreal tiles stream forever, so "network idle" never fires —
//     instead we wait until the *image stops changing* (sizes stable for ~1.5s),
//     which is true visual convergence. Only then do we release the sequence
//     (__heroGo) and keep the frames from that point. So capture begins over a
//     fully-rendered city, deterministically, every run.
//
// CDP screencast (not Playwright video → records WebGL as black; not
// page.screenshot → ~1fps).
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/User/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')

const W = 768, H = 1024
const SEQ_MS = 16000            // captured sequence length (after convergence)
const MIN_SETTLE_MS = 5000      // always give tiles this long to reach full LOD first
const CONVERGE_WINDOW_S = 2.5   // frames must be stable across this window
const CONVERGE_TOL = 0.03       // max (max-min)/mean JPEG size to call it stable
const CONVERGE_TIMEOUT_MS = 28000
const DIR = 'C:/Users/User/AppData/Local/Temp/hero-rec/frames'
rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Users/User/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars'],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
const page = await ctx.newPage()
const client = await page.context().newCDPSession(page)

const phase = () => page.evaluate(() => document.documentElement.dataset.heroPhase || '')
const waitForPhase = async (want, timeoutMs) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) { if ((await phase()) === want) return true; await sleep(150) }
  return false
}

await page.goto('http://localhost:3000/rec-hero', { waitUntil: 'load', timeout: 60000 })
if (!(await page.waitForSelector('gmp-map-3d', { timeout: 30000 }).then(() => true).catch(() => false)))
  console.log('! gmp-map-3d never mounted')

console.log('→ waiting for warmup dry-run to finish (phase=establishing) …')
await waitForPhase('establishing', 45000)

// Start the screencast early so we can measure convergence on the live frames.
const all = [] // { buf, t, size }
client.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
  const buf = Buffer.from(data, 'base64')
  all.push({ buf, t: metadata.timestamp, size: buf.length })
  client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 })

console.log('→ waiting for the establishing shot to visually converge …')
const t0 = Date.now()
let converged = false
while (Date.now() - t0 < CONVERGE_TIMEOUT_MS) {
  await sleep(250)
  if (Date.now() - t0 < MIN_SETTLE_MS) continue   // floor: let tiles reach full LOD
  if (all.length < 6) continue
  const lastT = all[all.length - 1].t
  const recent = all.filter((f) => f.t > lastT - CONVERGE_WINDOW_S)
  if (recent.length < 5) continue
  const sizes = recent.map((f) => f.size)
  const mn = Math.min(...sizes), mx = Math.max(...sizes)
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
  if ((mx - mn) / mean < CONVERGE_TOL) { converged = true; break }
}
console.log(converged ? '✓ converged — releasing sequence + capturing' : '! converge timed out — capturing anyway')

// Everything captured from here is the real sequence.
const startIdx = all.length
await page.evaluate(() => { window.__heroGo = true })
await sleep(SEQ_MS)
await client.send('Page.stopScreencast').catch(() => {})
await sleep(300)

const seq = all.slice(startIdx)
seq.forEach((f, i) => writeFileSync(`${DIR}/f_${String(i).padStart(4, '0')}.jpg`, f.buf))
writeFileSync(`${DIR}/frames.json`, JSON.stringify(seq.map((f) => ({ t: f.t }))))
const span = seq.length > 1 ? seq[seq.length - 1].t - seq[0].t : 0
console.log(`✓ ${seq.length} frames over ${span.toFixed(1)}s → ${(seq.length / (span || 1)).toFixed(1)} fps (warmup discarded ${startIdx})`)
await browser.close()
