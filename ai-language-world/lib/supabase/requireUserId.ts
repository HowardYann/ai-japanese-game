// lib/supabase/requireUserId.ts
import { createClient } from "./server";

/** 从当前会话取出登录用户id；未登录抛错，调用方负责转成401。
 *  Phase 6新增：顺带查一下banned开关——所有route都经过这个函数，
 *  是封禁生效的唯一关卡，不需要每个route单独判断。
 *  当前banned只能靠人工在Supabase SQL Editor里手动改（见npc生成审核设计），
 *  这里只负责"一旦被标记就真的拦下"，不负责判断谁该被封。
 *  故意不区分"未登录"和"被封禁"这两种失败对外的报错信息——调用方一律
 *  转成401，不让被封禁的用户能通过报错内容分辨出自己是被封了还是没登录。 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select("banned")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (profile?.banned) {
    throw new Error("BANNED");
  }

  return user.id;
}