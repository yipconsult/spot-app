// All TypeScript interfaces

export type Platform = 'instagram' | 'threads' | 'facebook' | 'red' | 'pinterest' | 'youtube' | 'openrice' | 'googlemaps' | 'dianping' | 'other';

export interface ParseRequest {
  url: string;
  text?: string;
  skip_cache?: boolean;
}

export interface OembedResult {
  text: string | null;
  thumbnailUrl: string | null;
}

export interface GmapsExtracted {
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  resolvedUrl: string;
}
