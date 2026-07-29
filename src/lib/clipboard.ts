import * as Clipboard from 'expo-clipboard';

const SOCIAL_PATTERNS = [
  /instagram\.com\/(p|reel|stories)\/[A-Za-z0-9_-]+/i,
  /xhslink\.com\/[A-Za-z0-9]+/i,
  /xiaohongshu\.com\/discovery\/item\/[A-Za-z0-9]+/i,
  /facebook\.com\/[A-Za-z0-9_.-]+\/(posts|videos|reels)\/[A-Za-z0-9]+/i,
  /pin\.it\/[A-Za-z0-9]+/i,
  /pinterest\.com\/pin\/[A-Za-z0-9]+/i,
  /threads\.net\/@[A-Za-z0-9_]+\/post\/[A-Za-z0-9]+/i,
  /youtube\.com\/shorts\/[A-Za-z0-9_-]+/i,
  /youtu\.be\/[A-Za-z0-9_-]+/i,
  /google\.com\/maps\//i,
  /maps\.app\.goo\.gl\//i,
  /goo\.gl\/maps\//i,
  /openrice\.com\//i,
  /dianping\.com\/shop\//i,
  /dpurl\.cn\//i,
];

export function isSocialUrl(text: string): boolean {
  return SOCIAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function extractUrl(text: string): string | null {
  const urlPattern = /https?:\/\/[^\s]+/g;
  const matches = text.match(urlPattern);
  if (!matches || matches.length === 0) return null;

  // Return the first URL that matches a social pattern
  for (const url of matches) {
    if (isSocialUrl(url)) return url;
  }

  // Fallback: return the first URL found
  return matches[0];
}

export async function checkClipboard(): Promise<string | null> {
  try {
    const hasString = await Clipboard.hasStringAsync();
    if (!hasString) return null;

    const text = await Clipboard.getStringAsync();
    if (!text) return null;

    return extractUrl(text);
  } catch {
    return null;
  }
}
