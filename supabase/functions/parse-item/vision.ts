// Vision OCR: extract text from social media thumbnails
import { GEMINI_URL, GEMINI_API_KEY } from './config.ts';

export async function extractTextFromThumbnail(thumbnailUrl: string): Promise<string | null> {
  try {
    const imgRes = await fetch(thumbnailUrl);
    if (!imgRes.ok) {
      console.log(`[Vision] Failed to download thumbnail: ${imgRes.status}`);
      return null;
    }

    const imgBytes = await imgRes.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imgBytes)));
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "This is a thumbnail from a social media post about a place in Hong Kong (likely a restaurant, cafe, or shop). Read ALL visible text from this image — including any overlaid text, captions, location tags, usernames, and restaurant names. Return ONLY the text you can see, exactly as it appears. If no text is visible, return 'NO_TEXT'." },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
    });

    if (!res.ok) {
      console.log(`[Vision] Gemini error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text || text === 'NO_TEXT') {
      console.log(`[Vision] No text found in thumbnail`);
      return null;
    }

    console.log(`[Vision] Extracted text (${text.length} chars): ${text.slice(0, 200)}`);
    return text;
  } catch (err) {
    console.log(`[Vision] Failed:`, err);
    return null;
  }
}
