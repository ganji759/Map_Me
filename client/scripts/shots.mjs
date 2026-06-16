import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/User/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')
const R = 'C:/Users/User/Documents/Map_Me/client/.rec'
const browser = await chromium.launch({ headless: false, executablePath: 'C:/Users/User/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
const page = await ctx.newPage()
await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 })
await page.bringToFront()
await new Promise(r=>setTimeout(r,1500))
await page.screenshot({ path: `${R}/show-hero.png` })          // original hero
await page.evaluate(() => document.getElementById('demo')?.scrollIntoView({ block:'center' }))
await new Promise(r=>setTimeout(r,6500))                         // let the video reach the crisp orbit
await page.screenshot({ path: `${R}/show-demo.png` })           // new section, full width
const box = await page.evaluate(() => { const v=document.querySelector('#demo video'); const b=v.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height)} })
await page.screenshot({ path: `${R}/show-video.png`, clip: box }) // just the video card
console.log('shots done')
await browser.close()
