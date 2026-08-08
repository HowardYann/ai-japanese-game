// lib/supabase/requireUserId.ts
import { createClient } from "./server";

/** 从当前会话取出登录用户id；未登录抛错，调用方负责转成401 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  return user.id;
}