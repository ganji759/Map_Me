// Interactive recorder: YOU judge when the render looks sharp.
// It launches a headed Chromium on /rec-hero, runs the tile warmup, then PARKS
// on the static establishing shot and waits. When you decide the render is good,
// a GO signal file is created → it releases the sequence and screencasts it.
//
// Coordination: run in background. It prints "READY" when parked. Creating the
// file  %TEMP%/hero-rec/GO  triggers the recording.
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/User/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')

const W = 768, H = 1024
const SEQ_MS = 16000
const BASE = 'C:/Users/User/AppData/Local/Temp/hero-rec'
const DIR = `${BASE}/frames`
const GO = `${BASE}/GO`
mkdirSync(DIR, { recursive: true })
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true })
if (existsSync(GO)) unlinkSync(GO) // clear any stale signal

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

await page.goto('http://localhost:3000/rec-hero', { waitUntil: 'load', timeout: 60000 })
if (!(await page.waitForSelector('gmp-map-3d', { timeout: 30000 }).then(() => true).catch(() => false)))
  console.log('! gmp-map-3d never mounted')

console.log('→ running warmup (camera caches DEST then START) …')
{ const t0 = Date.now(); while (Date.now() - t0 < 45000) { if ((await phase()) === 'establishing') break; await sleep(200) } }

console.log('READY: parked on the establishing shot. Watch the window; when it looks sharp, the GO file triggers recording.')

// Wait for the human GO signal (up to 12 minutes).
{ const t0 = Date.now(); while (!existsSync(GO)) { if (Date.now() - t0 > 720000) { console.log('! GO timed out'); await browser.close(); process.exit(0) } await sleep(400) } }
try { unlinkSync(GO) } catch { /* ignore */ }
console.log('GO received → recording the sequence')

const frames = []
client.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
  frames.push({ buf: Buffer.from(data, 'base64'), t: metadata.timestamp })
  client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
await page.evaluate(() => { window.__heroGo = true })
await sleep(SEQ_MS)
await client.send('Page.stopScreencast').catch(() => {})
await sleep(300)

frames.forEach((f, i) => writeFileSync(`${DIR}/f_${String(i).padStart(4, '0')}.jpg`, f.buf))
writeFileSync(`${DIR}/frames.json`, JSON.stringify(frames.map((f) => ({ t: f.t }))))
const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0
console.log(`✓ ${frames.length} frames over ${span.toFixed(1)}s → ${(frames.length / (span || 1)).toFixed(1)} fps`)
await browser.close()
