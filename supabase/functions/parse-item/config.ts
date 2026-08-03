// Environment variables and shared clients
import { createClient } from "jsr:@supabase/supabase-js@2";
import "jsr:@std/dotenv/load";

export const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const FB_APP_TOKEN = Deno.env.get("FB_APP_TOKEN") || "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
