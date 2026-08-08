import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ChatClient from "./chat-client";

// 和 app/world/page.tsx 一样的模式：服务端组件先做鉴权检查，
// 真正的交互（选NPC/发消息/结束对话）都是client组件的事。
export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return <ChatClient />;
}
