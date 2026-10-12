import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { makeHandler } from "./service.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(makeHandler(admin, caller.auth, (k) => Deno.env.get(k)));
