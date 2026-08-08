import { createBrowserClient } from "@supabase/ssr";

// 给 Client Component 用（比如登录表单）
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
