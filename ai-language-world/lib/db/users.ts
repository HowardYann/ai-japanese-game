// lib/db/users.ts
//
// Phase 6：审核通知邮件需要带上"哪个账号生成的"，public.users镜像了email，
// 不需要额外走auth.admin接口。

import { createClient } from "../supabase/server";

export async function getUserEmail(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.email ?? null;
}
