import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 用户点击邮箱里的 magic link 后会跳到这里
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/world";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 出错就打回登录页，带个错误提示
  return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
}
