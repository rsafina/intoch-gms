// Settings navigation is presentation only; hasAccess and database roles remain authoritative.
const SETTINGS_GROUPS = [
  { label: 'Reservations', pages: [['settings-thresholds', 'Booking rules'], ['areas', 'Areas & tables'], ['settings-menu', 'Online booking page'], ['settings-outlook', 'Outlook']] },
  { label: 'Deposits & Payments', pages: [['settings-financial', 'Deposit rules'], ['settings-payments', 'Payment instructions']] },
  { label: 'Guest Spending', pages: [['settings-spending', 'Guest Spending']] },
  { label: 'Membership & Rewards', pages: [['settings-membership', 'Membership rules'], ['prizes', 'Spin Wheel Prizes']] },
  { label: 'WhatsApp Messages', pages: [['settings-wa', 'WhatsApp Messages']] },
  { label: 'Branding', pages: [['settings-branding', 'Branding']] },
  { label: 'Staff & Access', pages: [['settings-staff', 'Staff & Access']] },
];

function settingsGroup(page) {
  return SETTINGS_GROUPS.find(group => group.pages.some(([key]) => key === page));
}

function sidebarUsesIcons() {
  return document.body.classList.contains('sidebar-compact') && !window.matchMedia('(max-width: 640px)').matches;
}

function renderSettingsNavigation(page) {
  const group = settingsGroup(page);
  const children = document.getElementById('settings-children');
  if (!children) return;
  children.innerHTML = SETTINGS_GROUPS.map(item => {
    const pages = item.pages.filter(([key]) => hasAccess(key));
    if (!pages.length) return '';
    const target = item === group ? page : pages[0][0];
    return `<button class="settings-child${item === group ? ' is-active' : ''}" ${item === group ? 'aria-current="page"' : ''} onclick="navigateTo('${target}')">${t(item.label)}</button>`;
  }).join('');
  if (group && !sidebarUsesIcons()) setSettingsExpanded(true);
  document.querySelectorAll('[data-settings-tabs]').forEach(el => {
    const ownPage = el.closest('.page-section')?.id.replace('page-', '');
    const ownGroup = settingsGroup(ownPage);
    if (!ownGroup) return;
    const pages = ownGroup.pages.filter(([key]) => hasAccess(key));
    el.innerHTML = `<p class="settings-breadcrumb">${t('Settings')} / ${t(ownGroup.label)}</p>` +
      (pages.length > 1 ? `<nav class="settings-local-tabs" aria-label="${t(ownGroup.label)}">${pages.map(([key,label]) => `<button ${key === ownPage ? 'aria-current="page"' : ''} onclick="navigateTo('${key}')">${t(label)}</button>`).join('')}</nav>` : '');
  });
  document.querySelectorAll('#app-sidebar [data-nav]').forEach(el => {
    const label = el.querySelector('.nav-label')?.textContent.trim();
    if (label) { el.title = label; el.setAttribute('aria-label', label); }
  });
  const mobile = document.getElementById('sidebar-mobile-toggle');
  mobile?.classList.toggle('hidden', document.getElementById('app-main')?.classList.contains('hidden'));
}

function setSettingsExpanded(open) {
  const children = document.getElementById('settings-children');
  if (!children) return;
  children.hidden = !open;
  document.querySelector('[data-nav="settings"]')?.setAttribute('aria-expanded', String(open));
}

function toggleSettingsNavigation() {
  const open = document.getElementById('settings-children').hidden;
  renderSettingsNavigation(typeof currentPage === 'string' ? currentPage : '');
  setSettingsExpanded(open);
}

function toggleSidebarSize() {
  if (window.matchMedia('(max-width: 640px)').matches) { toggleSidebarDrawer(false); return; }
  const compact = !document.body.classList.contains('sidebar-compact');
  applySidebarSize(compact);
  try { localStorage.setItem('intoch.sidebarCompact', String(compact)); } catch (_) { /* Storage can be unavailable. */ }
}

function applySidebarSize(compact) {
  document.body.classList.toggle('sidebar-compact', compact);
  const button = document.getElementById('sidebar-size-toggle');
  if (button) {
    button.textContent = compact ? '›' : '‹';
    button.setAttribute('aria-expanded', String(!compact));
    button.setAttribute('aria-label', t(compact ? 'Expand sidebar' : 'Collapse sidebar'));
    button.title = button.getAttribute('aria-label');
  }
  setSettingsExpanded(!sidebarUsesIcons() && !!settingsGroup(typeof currentPage === 'string' ? currentPage : ''));
}

function toggleSidebarDrawer(open) {
  const visible = open ?? !document.body.classList.contains('sidebar-drawer-open');
  document.body.classList.toggle('sidebar-drawer-open', visible);
  document.getElementById('sidebar-backdrop').hidden = !visible;
  document.getElementById('sidebar-mobile-toggle').setAttribute('aria-expanded', String(visible));
  if (visible) {
    const close = document.getElementById('sidebar-size-toggle');
    close?.setAttribute('aria-label', t('Close navigation'));
    close?.focus();
    document.querySelector('#settings-children .is-active')?.scrollIntoView?.({ block: 'nearest' });
  }
  else document.getElementById('sidebar-mobile-toggle')?.focus();
}

function settingsNavigationChanged(page) {
  renderSettingsNavigation(page);
  if (sidebarUsesIcons()) setSettingsExpanded(false);
  if (document.body.classList.contains('sidebar-drawer-open')) toggleSidebarDrawer(false);
  if (!sidebarUsesIcons()) document.querySelector('#settings-children .is-active')?.scrollIntoView?.({ block: 'nearest' });
}

// Baselines belong to the visible settings page. Separate saves only clear their own controls.
const settingsBaselines = new WeakMap();
const SETTINGS_TRACKED_PAGES = new Set(['settings-thresholds', 'settings-spending', 'settings-membership', 'settings-financial', 'settings-payments', 'settings-outlook']);
function settingsInputValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }
function settingsCaptureBaseline(root) {
  if (!root) return;
  root.querySelectorAll('input:not([type="file"]), select, textarea').forEach(el => {
    // Date exceptions are committed immediately by Add date, with their own result list.
    if (!el.id.startsWith('set-exc-')) settingsBaselines.set(el, settingsInputValue(el));
  });
  settingsUpdateDirtyState();
}
function settingsIsDirty() {
  const page = typeof currentPage === 'string' ? currentPage : '';
  if (!SETTINGS_TRACKED_PAGES.has(page)) return false;
  const root = document.getElementById('page-' + page);
  return !!root && [...root.querySelectorAll('input, select, textarea')].some(el => settingsBaselines.has(el) && settingsBaselines.get(el) !== settingsInputValue(el));
}
function settingsUpdateDirtyState() {
  const root = document.querySelector('.page-section.active');
  if (!root || !SETTINGS_TRACKED_PAGES.has(root.id.replace('page-', ''))) return;
  let notice = root.querySelector('.settings-dirty-notice');
  if (!notice) {
    notice = document.createElement('p'); notice.className = 'settings-dirty-notice'; notice.setAttribute('role', 'status');
    root.querySelector('[data-settings-tabs]')?.after(notice);
  }
  notice.textContent = settingsIsDirty() ? t('Unsaved changes') : '';
  notice.hidden = !settingsIsDirty();
}
function settingsMayNavigate() {
  return !settingsIsDirty() || window.confirm(t('Leave this page and discard unsaved changes?'));
}

document.addEventListener('DOMContentLoaded', () => {
  let compact = window.matchMedia('(min-width: 641px) and (max-width: 900px)').matches;
  try { const saved = localStorage.getItem('intoch.sidebarCompact'); if (saved !== null) compact = saved === 'true'; } catch (_) { /* Use viewport default. */ }
  applySidebarSize(compact);
  document.addEventListener('click', event => {
    if (sidebarUsesIcons() && !event.target.closest('#settings-children, [data-nav="settings"]')) setSettingsExpanded(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && document.body.classList.contains('sidebar-drawer-open')) {
      const items = [...document.querySelectorAll('#app-sidebar button:not([disabled]), #app-sidebar a[href]')].filter(el => el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key !== 'Escape') return;
    if (document.body.classList.contains('sidebar-drawer-open')) toggleSidebarDrawer(false);
    if (sidebarUsesIcons()) {
      const wasOpen = !document.getElementById('settings-children').hidden;
      setSettingsExpanded(false);
      if (wasOpen) document.querySelector('[data-nav="settings"]')?.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 640px)').matches && document.body.classList.contains('sidebar-drawer-open')) toggleSidebarDrawer(false);
  });
  document.addEventListener('input', settingsUpdateDirtyState);
  document.addEventListener('change', settingsUpdateDirtyState);
  window.addEventListener('beforeunload', event => { if (settingsIsDirty()) { event.preventDefault(); event.returnValue = ''; } });
});
