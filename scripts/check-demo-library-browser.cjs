// Optional local Chrome verification. Start serve-demo-library.cjs first.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'intoch-demo-visual-'));
const executable = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9333', '--user-data-dir=' + path.join(output, 'profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const base = 'http://127.0.0.1:8088';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let socket;
const watchdog = setTimeout(() => { console.error('Browser check exceeded 120 seconds'); chrome.kill(); process.exit(1); }, 120000);
async function main() {
  let tabs;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { tabs = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await delay(200); }
  }
  assert.ok(tabs, 'Chrome debugging endpoint opened');
  socket = new WebSocket(tabs.find(item => item.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0; const pending = new Map(); const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.id) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
  });
  function command(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  async function navigate(route) {
    await command('Page.navigate', { url: base + route });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(`location.pathname === ${JSON.stringify(route)} && document.readyState === 'complete' && !!document.querySelector('.demo-steps')`)) return;
      await delay(100);
    }
    throw new Error('Demo did not load: ' + route);
  }
  async function capture(name) {
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  for (const [width, height] of [[1440,900], [1280,720], [393,852], [320,640]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await navigate('/demo/reactivation');
    const slugs = await evaluate('IntochDemoData.definitions.map(item => item.slug)');
    for (const slug of slugs) {
      await navigate('/demo/' + slug);
      const count = await evaluate('document.querySelectorAll(".demo-steps [data-step]").length');
      for (let index = 0; index < count; index++) {
        await evaluate(`document.querySelectorAll('.demo-steps [data-step]')[${index}].click()`);
        const overflow = await evaluate(`({page: document.documentElement.scrollWidth > innerWidth, scene: document.getElementById('scene').scrollWidth > document.getElementById('scene').clientWidth})`);
        assert.deepEqual(overflow, { page: false, scene: false }, `${slug} step ${index} at ${width}px`);
        const visibleTogether = await evaluate(`['.story-stage','#story-title','#story-text','.demo-steps'].map(selector => { const bounds = document.querySelector(selector).getBoundingClientRect(); return {selector, top:bounds.top, bottom:bounds.bottom, visible:bounds.top >= 0 && bounds.bottom <= innerHeight}; })`);
        assert.ok(visibleTogether.every(item => item.visible), `${slug} step ${index} must show devices, caption and controls without scrolling at ${width}x${height}: ${JSON.stringify(visibleTogether)}`);
        if (width < 500) {
          assert.ok(await evaluate('parseFloat(getComputedStyle(document.querySelector("#scene .scene-heading h3")).fontSize) >= 14'), 'mobile detail heading is readable without device scaling');
          assert.equal(await evaluate('document.querySelector(".detail-toolbar")'), null, 'no screen switches');
        }
        if (['reactivation', 'reservation', 'customer-database', 'walk-in'].includes(slug) && width !== 320) await capture(`${slug}-${width}-${index + 1}`);
      }
      await command('Page.reload', { ignoreCache: true });
      for (let attempt = 0; attempt < 40; attempt++) { if (await evaluate('document.readyState === "complete" && !!document.querySelector(".demo-steps")')) break; await delay(100); }
      assert.equal(await evaluate('document.querySelectorAll(".demo-steps [data-step]").length'), count, 'refresh preserves direct route');
    }
  }
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
  await navigate('/demo/reservation');
  assert.equal(await evaluate('document.querySelector(".story-stage").dataset.shot'), 'overview');
  await delay(3600);
  assert.equal(await evaluate('document.querySelector(".story-stage").dataset.shot'), 'companion', 'camera automatically zooms into guest form');
  await capture('automatic-guest-393');
  await delay(4900);
  assert.equal(await evaluate('document.querySelector(".story-stage").dataset.shot'), 'main', 'camera automatically reveals dashboard result');
  assert.equal(await evaluate('scrollY'), 0, 'automatic camera never scrolls the page');
  await capture('automatic-result-393');
  await navigate('/demo/reactivation');
  await delay(2600);
  assert.equal(await evaluate('document.getElementById("demo-root").dataset.beat'), '1', 'autoplay advances');
  await evaluate('document.getElementById("pause").click()');
  await delay(2700);
  assert.equal(await evaluate('document.getElementById("demo-root").dataset.beat'), '1', 'pause stops autoplay');
  await evaluate('document.querySelectorAll(".demo-steps button")[1].click()');
  assert.equal(await evaluate('document.getElementById("demo-root").dataset.beat'), '0', 'step switch restarts scene');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // MediaQueryList dispatches change asynchronously after emulation is applied.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await evaluate('document.getElementById("demo-root").dataset.beat === "3"')) break;
    await delay(100);
  }
  assert.equal(await evaluate('document.getElementById("demo-root").dataset.beat'), '3', 'live reduced-motion change settles scene');
  // Check a real pointer in motion, not only the step timer or a reduced-motion image.
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await navigate('/demo/reservation');
  await delay(400);
  const startPointer = await evaluate('document.querySelector(".demo-pointer").getBoundingClientRect().x');
  await delay(500);
  assert.notEqual(await evaluate('document.querySelector(".demo-pointer").getBoundingClientRect().x'), startPointer, 'pointer travels smoothly toward a real control');
  await capture('reservation-cursor-moving-1440');
  await evaluate('document.getElementById("pause").click()');
  await evaluate('Promise.all(document.querySelector(".demo-pointer").getAnimations().map(animation => animation.ready)).then(() => true)');
  const pausedPointer = await evaluate('document.querySelector(".demo-pointer").getAnimations()[0].currentTime');
  await delay(300);
  assert.equal(await evaluate('document.querySelector(".demo-pointer").getAnimations()[0].currentTime'), pausedPointer, 'pause freezes the cursor mid-path');
  await evaluate('document.getElementById("pause").click()');
  await delay(300);
  assert.ok(await evaluate('document.querySelector(".demo-pointer").getAnimations()[0].currentTime') > pausedPointer, 'resume continues cursor progress');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: base + '/landing' });
  for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate('location.pathname === "/landing" && document.readyState === "complete" && !!document.getElementById("uc-t1")')) break; await delay(100); }
  await evaluate('document.getElementById("use-case").scrollIntoView()');
  await capture('landing-1440');
  await evaluate('document.getElementById("uc-t3").click()');
  assert.equal(await evaluate('document.getElementById("uc-t3").getAttribute("aria-selected")'), 'true');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("uc-p3")).display'), 'grid');
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log('PASS: all nine routes and refresh; devices, caption and controls together at 1440x900, 1280x720, 393x852 and 320x640; no horizontal overflow; landing tabs and motion controls.');
  console.log('Screenshots: ' + output);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(watchdog); if (socket) socket.close(); chrome.kill(); });
