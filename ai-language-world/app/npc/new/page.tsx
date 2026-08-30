import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NpcNewClient from "./npc-new-client";

// 和 app/home/page.tsx、app/chat/page.tsx 同一个模式：
// 服务端组件只做鉴权检查，真正的交互都是client组件的事。
export default async function NpcNewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return <NpcNewClient />;
}
