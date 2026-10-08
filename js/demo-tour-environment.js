/* Public presentation allowlist, NOT authorization. RLS and verified Auth remain authoritative.
 * User confirmed this existing project is the fictional Intoch playground (2026-10-08).
 * The playground project is pinned to the existing demo-regression safety manifest.
 * Demo origins include the user-confirmed Cloudflare demo hostname.
 * Never enable by query string, localStorage, name matching or demo-mode alone.
 * See docs/DEMO_TOUR.md. Do not put credentials in this file.
 */
window.INTOCH_DEMO_TOUR_ENV = Object.freeze({
  origins: Object.freeze(["https://demo.intoch.app", "https://dashboard.intoch.app", "http://localhost:8080", "http://127.0.0.1:8080"]),
  supabaseUrl: "https://hkrhsubhfqrgqkuhpvql.supabase.co",
  // Existing fictional seed examples. IDs are resolved from successful app reads, never guessed.
  fictionalGuestNames: Object.freeze(["Budi Santoso", "Michelle", "Jessica"]),
});
