/* Intentionally PUBLIC playground credentials supplied by the user for prospect
 * autofill. This is a demo-only exception, never a private staff/admin credential.
 * Presentation gates do not authorize access: Login still uses verified Supabase Auth.
 */
(function () {
  "use strict";
  const username = "intoch-demo", pin = "1212";
  const text = (en, id) => typeof demoText === "function" ? demoText(en, id) : en;
  function allowed() {
    const env = window.INTOCH_DEMO_TOUR_ENV;
    return !!(env?.origins?.includes(location.origin) && env.supabaseUrl &&
      typeof SUPABASE_URL !== "undefined" && env.supabaseUrl === SUPABASE_URL &&
      typeof demoEnabled === "function" && demoEnabled());
  }
  function teardown() {
    document.getElementById("demo-login-hint")?.remove();
    const submit = document.querySelector('[data-tour="login-submit"]');
    submit?.classList.remove("demo-login-highlight");
    if (submit) {
      const descriptions = (submit.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== "demo-login-hint");
      if (descriptions.length) submit.setAttribute("aria-describedby", descriptions.join(" "));
      else submit.removeAttribute("aria-describedby");
    }
  }
  function prepare() {
    teardown();
    if (!allowed()) return false;
    const name = document.getElementById("login-username"), code = document.getElementById("login-pin");
    const submit = document.querySelector('[data-tour="login-submit"]');
    if (!name || !code || !submit) return false;
    // Respect saved/typed credentials for a different staff account.
    if (!name.value && !code.value) { name.value = username; code.value = pin; }
    else if (name.value === username && !code.value) code.value = pin;
    const hint = document.createElement("p"); hint.id = "demo-login-hint"; hint.className = "demo-login-hint";
    hint.textContent = text("Click Login to continue to the Intoch demo. You can explore freely or choose a guided tour.", "Klik Login untuk melanjutkan ke demo Intoch. Jelajahi dengan bebas atau pilih tur terpandu.");
    submit.before(hint); submit.classList.add("demo-login-highlight");
    submit.setAttribute("aria-describedby", [submit.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
    return name.value === username && code.value === pin;
  }
  window.DemoLogin = Object.freeze({ prepare, teardown });
})();
