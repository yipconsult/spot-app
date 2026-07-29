# Spot App — Test Plan

**Version:** 1.0.0 | **Date:** 2026-07-27

---

## Parsing — Per Platform

| # | Test | How |
|---|---|---|
| 1 | **Instagram** post with caption + location | Paste URL → Parse → verify name, address, category, tags |
| 2 | **Instagram** post with minimal caption | Paste URL → verify fallback hints or partial data |
| 3 | **Instagram Reel** with text overlay | Paste URL → verify Vision OCR reads thumbnail text |
| 4 | **Threads** post | Paste URL → verify same flow as Instagram |
| 5 | **OpenRice** full page URL | Paste URL → verify name, address, cuisine, price |
| 6 | **OpenRice** short link (`s.openrice.com`) | Paste URL → verify "Can't resolve" hint + Look Up works |
| 7 | **Google Maps** place URL | Paste URL → verify name from URL + address enrichment |
| 8 | **Google Maps** short link (`goo.gl/maps`) | Paste URL → verify link resolution + parse |
| 9 | **RED/小红书** post URL | Paste URL → verify best-effort parse (accept partial) |
| 10 | **Dianping/大众点评** shop URL | Paste URL → verify best-effort parse |
| 11 | **Facebook** public post URL | Paste URL → verify basic parse |
| 12 | **YouTube** Shorts URL | Paste URL → verify basic parse |
| 13 | **Pinterest** pin URL | Paste URL → verify basic parse |
| 14 | **Unknown/generic** URL | Paste URL → verify "couldn't extract" hint + Look Up works |

## Save Flow

| # | Test | How |
|---|---|---|
| 15 | Clipboard banner appears | Copy Instagram/OpenRice URL → open app → banner shows |
| 16 | Clipboard → auto-parse | Tap clipboard banner → verify form fills automatically |
| 17 | Paste link → Parse & Edit | Manually paste URL → tap Parse → verify form fills |
| 18 | Edit parsed fields | Change name, category, address in form → Save → verify saved |
| 19 | **Look Up** fast path | Type a restaurant name → tap Look Up → verify address filled |
| 20 | **Look Up** reverse | Have address but no name → verify Tier 1.5 fills name |
| 21 | Error hint display | Parse RED URL → verify blue hint banner with guidance |
| 22 | Share another post (back-to-back) | Save one post → share another → verify new data (not stale) |

## Link Preview Cards

| # | Test | How |
|---|---|---|
| 23 | Platform icon display | Save spots from Instagram, OpenRice, Maps → verify correct colored icons |
| 24 | Tag preview | Save spot with tags → verify tags shown in card |
| 25 | Category + district row | Save spot with district → verify displayed |
| 26 | Address display | Save spot with address → verify location pin + address |

## Caching

| # | Test | How |
|---|---|---|
| 27 | Same URL parse twice | Parse a URL → Save it → Parse same URL again → verify instant (sub-100ms) |
| 28 | Different user hits cache | First user parses + saves → second user parses same URL → instant |

## Lists + Export

| # | Test | How |
|---|---|---|
| 29 | Create shared list | Profile → Create Shared List → verify share code generated |
| 30 | Copy share code | Tap Copy Code → paste elsewhere → verify code |
| 31 | Join shared list | Profile → Join → enter code → verify list appears |
| 32 | **Share List as Text** | Open shared list → tap Share as Text → verify formatted text in share sheet |
| 33 | **Export CSV** | Profile → Export Spots as CSV → verify CSV opens correctly |

## Dark Mode

| # | Test | How |
|---|---|---|
| 34 | Toggle dark mode | Settings → Developer → Appearance → Dark |
| 35 | Home screen dark | Verify saves list, search bar, cards all adapt |
| 36 | Save screen dark | Open save form → verify inputs, chips, buttons adapt |
| 37 | Profile dark | Verify header, menu items, taste cards adapt |
| 38 | Onboarding dark | Fresh install → verify onboarding screens dark |
| 39 | Tab bar dark | Verify tab bar background + active color |

## Edge Cases

| # | Test | How |
|---|---|---|
| 40 | Invalid URL (not a link) | Type "hello" → Parse → verify graceful error |
| 41 | URL already saved | Parse + save → parse same URL again → verify no duplicate |
| 42 | Network offline | Turn off internet → Parse → verify error message |
| 43 | App background/foreground | Parse → background app → foreground → verify no crash/state loss |

## Share Extension (TestFlight Only)

| # | Test | How |
|---|---|---|
| 44 | Share from Instagram app | In Instagram → Share → Spot → verify auto-parse with caption text |
| 45 | Share from Safari | In Safari → Share → Spot → verify auto-parse with URL + page title |
| 46 | Share two posts back-to-back | Share one → dismiss → share another → verify new data |

---

**Priority:** 1-22 (core parsing + save flow), 32-33 (export), 44-46 (TestFlight). The rest verify specific features.
