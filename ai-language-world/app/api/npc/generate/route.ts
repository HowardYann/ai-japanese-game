// app/api/npc/generate/route.ts
//
// Phase 6：独立创建NPC入口，第1步。玩家自由输入描述 -> 生成persona草案 -> 回给前端预览/编辑。
// 跟 scenario/generate 同一个设计：这一步不写DB，避免生成了但玩家没用的草稿变成脏数据。
//
// 这一步也顺带过一次安全审核——被拦下的内容不应该原样展示给玩家在预览页看到/编辑，
// 真正的持久化关卡在 app/api/npc/create/route.ts，那里会对（可能被编辑过的）最终版本再查一次，
// 这里的审核只是提前拦截、不让玩家在预览页面对着一份有问题的草稿。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { buildPersonaGenerationContext, parsePersonaResult } from "../../../../lib/npc/generatePersona";
import { callClaude } from "../../../../lib/claude/client";
import { enforcePersonaSafety, PersonaRejectedError } from "../../../../lib/npc/enforcePersonaSafety";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const input = body?.input;

  if (!input || typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }
  if (input.trim().length > 300) {
    return NextResponse.json({ error: "input too long" }, { status: 400 });
  }

  try {
    const { systemPrompt, userMessage } = buildPersonaGenerationContext(input);
    const raw = await callClaude(systemPrompt, [{ role: "user", content: userMessage }]);
    const draft = parsePersonaResult(raw);

    await enforcePersonaSafety({
      userId,
      rawInput: input,
      displayName: draft.displayName,
      persona: draft.persona,
    });

    return NextResponse.json({ draft });
  } catch (err) {
    if (err instanceof PersonaRejectedError) {
      // 不透露具体命中了哪条审核标准——避免变成一份"怎么绕过审核"的说明书
      return NextResponse.json(
        { error: "这个人设暂时无法创建，换个描述试试" },
        { status: 422 }
      );
    }
    console.error("NPC persona generation failed", err);
    return NextResponse.json({ error: "Persona generation failed" }, { status: 500 });
  }
}
