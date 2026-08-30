// app/api/feedback/create/route.ts
//
// 每个页面右下角"提建议"入口的提交端点。故意不用 requireUserId 硬性要求登录——
// 登录页（/）也挂了这个入口，未登录访客也应该能提建议。
// 能拿到登录用户id就带上，拿不到（包括未登录/被封禁两种情况，
// requireUserId 本身故意不区分）就当匿名反馈写入，不阻断提交流程。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { insertFeedback } from "../../../../lib/db/feedback";
import { createClient } from "../../../../lib/supabase/server";

const MAX_CONTENT_LENGTH = 2000;


export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content = body?.content;
  const pagePath = body?.pagePath;

  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `content must be under ${MAX_CONTENT_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (typeof pagePath !== "string" || pagePath.trim().length === 0) {
    return NextResponse.json({ error: "pagePath is required" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    userId = await requireUserId();
  } catch {
    userId = null; // 未登录/被封禁，都当匿名反馈处理
  }
 


  try {
    await insertFeedback({ userId, pagePath: pagePath.trim(), content: content.trim() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to insert feedback", err);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}