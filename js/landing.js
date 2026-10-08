/* Marketing-only interactions; no application or guest data access. */
(function () {
  'use strict';
  const nav = document.getElementById('navLinks');
  const toggle = document.getElementById('navToggle');
  const overlay = document.getElementById('navOverlay');
  function menu(open, restore) {
    nav.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', document.documentElement.lang === 'en' ? (open ? 'Close menu' : 'Open menu') : (open ? 'Tutup menu' : 'Buka menu'));
    if (restore) toggle.focus();
  }
  toggle.addEventListener('click', () => menu(toggle.getAttribute('aria-expanded') !== 'true'));
  overlay.addEventListener('click', () => menu(false, true));
  nav.addEventListener('click', event => { if (event.target.closest('a')) menu(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') menu(false, true); });
  window.addEventListener('resize', () => { if (window.innerWidth > 800) menu(false); });
  function select(list, chosen, focus) {
    list.querySelectorAll('[role=tab]').forEach(tab => {
      const active = tab === chosen;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    });
    if (focus) chosen.focus();
    list.dispatchEvent(new CustomEvent('intoch:tabchange', { bubbles: true, detail: { tab: chosen } }));
  }
  document.querySelectorAll('[role=tablist]').forEach(list => {
    const tabs = Array.from(list.querySelectorAll('[role=tab]'));
    list.addEventListener('click', event => { const tab = event.target.closest('[role=tab]'); if (tab) select(list, tab); });
    list.addEventListener('keydown', event => {
      const index = tabs.indexOf(event.target);
      if (index < 0) return;
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); select(list, tabs[next], true); }
    });
  });
  function revealHash() {
    const target = document.getElementById(location.hash.slice(1));
    if (target && target.matches('[role=tabpanel]')) {
      const tab = document.getElementById(target.getAttribute('aria-labelledby'));
      select(tab.closest('[role=tablist]'), tab);
      target.scrollIntoView({ block: 'start' });
    }
  }
  window.addEventListener('hashchange', revealHash);
  revealHash();
  const section = document.getElementById('use-case');
  const panels = Array.from(section.querySelectorAll('.v2-panel'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = panels.find(panel => !panel.hidden), phase = reduced.matches ? 3 : 1, paused = false, staticView = false, visible = false, timer;
  const en = () => document.documentElement.lang === 'en';
  function stop() { clearTimeout(timer); timer = undefined; }
  function controls() {
    panels.forEach(panel => {
      panel.querySelectorAll('[data-demo-step]').forEach(button => {
        button.setAttribute('aria-pressed', String(panel === active && Number(button.dataset.demoStep) === phase));
        button.setAttribute('aria-label', (en() ? 'Show step ' : 'Tampilkan langkah ') + button.dataset.demoStep);
      });
      const pause = panel.querySelector('.demo-pause');
      pause.textContent = paused ? (en() ? 'Play' : 'Putar') : (en() ? 'Pause' : 'Jeda');
      pause.setAttribute('aria-pressed', String(paused));
      pause.hidden = reduced.matches;
      panel.querySelector('.demo-replay').textContent = en() ? 'Replay' : 'Ulangi';
      panel.querySelector('.demo-duration').textContent = reduced.matches ? (en() ? 'Select a step to explore' : 'Pilih langkah untuk melihat demo') : (en() ? 'Short demo · 7 seconds' : 'Demo singkat · 7 detik');
      panel.classList.toggle('demo-paused', paused || !visible || document.hidden);
      panel.classList.toggle('demo-static', staticView || paused || reduced.matches);
    });
  }
  function paint() {
    active.dataset.phase = phase;
    active.querySelectorAll('[data-step]').forEach(item => item.classList.toggle('current', Number(item.dataset.step) === phase));
    controls();
  }
  function schedule() {
    stop();
    controls();
    if (!visible || paused || reduced.matches || document.hidden) return;
    timer = setTimeout(() => { staticView = false; phase = phase % 3 + 1; paint(); schedule(); }, 2300);
  }
  panels.forEach(panel => {
    const row = document.createElement('div');
    row.className = 'demo-controls';
    row.innerHTML = '<button type="button" data-demo-step="1">1</button><button type="button" data-demo-step="2">2</button><button type="button" data-demo-step="3">3</button><button type="button" class="demo-pause"></button><button type="button" class="demo-replay"></button><span class="demo-duration"></span>';
    panel.querySelector('.v2-panel-copy').appendChild(row);
    panel.querySelector('[data-step="1"]').classList.add('current');
    row.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.demoStep) { phase = Number(button.dataset.demoStep); paused = true; staticView = true; }
      else if (button.classList.contains('demo-pause')) paused = !paused;
      else { phase = 1; paused = false; staticView = false; }
      paint(); schedule();
    });
  });
  section.addEventListener('intoch:tabchange', event => {
    active = document.getElementById(event.detail.tab.getAttribute('aria-controls'));
    phase = reduced.matches ? 3 : 1;
    staticView = false;
    paint(); schedule();
  });
  document.addEventListener('intoch:languagechange', () => { controls(); menu(toggle.getAttribute('aria-expanded') === 'true'); });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', stop);
  reduced.addEventListener('change', () => { phase = reduced.matches ? 3 : 1; paint(); schedule(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }, { threshold: .1 }).observe(section);
  } else { visible = true; schedule(); }
  paint();
}());
