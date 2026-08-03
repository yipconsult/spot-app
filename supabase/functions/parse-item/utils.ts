// Pure helper functions — no external dependencies

export function safeParseGeminiJson(text: string): Record<string, unknown> {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch { /* fall through */ }

  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  const result: Record<string, unknown> = {};
  const fieldPattern = /"(\w+)":\s*("(?:[^"\\]|\\.)*"|null|\[[^\]]*\]|"[^"\n]*)/g;
  let match;
  while ((match = fieldPattern.exec(cleaned)) !== null) {
    const key = match[1];
    const rawVal = match[2];
    try {
      if (rawVal === 'null') {
        result[key] = null;
      } else if (rawVal.startsWith('[')) {
        result[key] = JSON.parse(rawVal);
      } else if (rawVal.startsWith('"')) {
        result[key] = JSON.parse(rawVal);
      } else {
        result[key] = rawVal;
      }
    } catch {
      if (rawVal.startsWith('"')) {
        result[key] = rawVal.slice(1).replace(/["\\]$/, '').trim() || null;
      }
    }
  }

  if (Object.keys(result).length > 0) {
    console.log(`[safeParse] Extracted ${Object.keys(result).length} fields from partial JSON`);
    return result;
  }

  console.log("[safeParse] Could not extract any fields, returning empty. First 200 chars:", text.slice(0, 200));
  return {};
}

export function findNoteInNextData(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  if (o.noteId && (o.title || o.desc)) return o;

  if (o.noteInfo && typeof o.noteInfo === 'object') {
    const ni = o.noteInfo as Record<string, unknown>;
    if (ni.noteId && (ni.title || ni.desc)) return ni;
  }

  if (o.noteDetailMap && typeof o.noteDetailMap === 'object') {
    const entries = Object.values(o.noteDetailMap as Record<string, unknown>);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (e.noteId && (e.title || e.desc)) return e;
      if (e.note && typeof e.note === 'object') {
        const note = e.note as Record<string, unknown>;
        if (note.title || note.desc) return note;
      }
    }
  }

  if (o.initialState && typeof o.initialState === 'object') {
    const found = findNoteInNextData(o.initialState);
    if (found) return found;
  }
  if (o.pageState && typeof o.pageState === 'object') {
    const found = findNoteInNextData(o.pageState);
    if (found) return found;
  }

  for (const key of Object.keys(o)) {
    if (key === '__proto__' || key === 'constructor') continue;
    const val = o[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findNoteInNextData(item);
        if (found) return found;
      }
    } else if (typeof val === 'object' && val !== null) {
      const found = findNoteInNextData(val);
      if (found) return found;
    }
  }
  return null;
}

export function findDianpingShopData(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  if ((o.shopId || o.shopID) && (o.shopName || o.name)) return o;
  if (o.shopName && o.address) return o;

  for (const key of Object.keys(o)) {
    if (key === '__proto__' || key === 'constructor') continue;
    const val = o[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findDianpingShopData(item);
        if (found) return found;
      }
    } else if (typeof val === 'object' && val !== null) {
      const found = findDianpingShopData(val);
      if (found) return found;
    }
  }
  return null;
}
