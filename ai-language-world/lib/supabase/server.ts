import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 给 Server Component / Server Action / Route Handler 用
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component 里调用 setAll 会报错，可以忽略——
            // 只要 middleware 在刷新 session 就没问题
          }
        },
      },
    }
  );
}
