// app/api/scenario/generate/route.ts
//
// Phase 1（V2场景驱动改版）：玩家在首页自由输入想体验的事情，
// 前端调这个接口拿到结构化场景，展示成"Scenario Preview"确认页。
//
// 这一步刻意不写DB——玩家还没点"开始体验"之前产生的场景数据是一次性的，
// 确认后才由 /api/event/start 把scenario连同npcId一起存进events表，
// 避免生成了但玩家没用的场景变成脏数据。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { listNpcIds, getNpcConfig } from "../../../../lib/npc/registry";
import { buildScenarioContext, parseScenarioResult } from "../../../../lib/context/buildScenarioContext";
import { callClaude } from "../../../../lib/claude/client";

export async function POST(req: NextRequest) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const input = body?.input;

  if (!input || typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }
  if (input.trim().length > 300) {
    // 场景描述不是长文，超长输入大概率不是正常使用，早点拦掉避免prompt被灌注大段无关内容
    return NextResponse.json({ error: "input too long" }, { status: 400 });
  }

  const npcIds = listNpcIds();
  const npcs = npcIds.map((id) => getNpcConfig(id));

  const { systemPrompt, userMessage } = buildScenarioContext(input, npcs);

  try {
    const raw = await callClaude(systemPrompt, [{ role: "user", content: userMessage }]);
    const scenario = parseScenarioResult(raw, npcIds);
    return NextResponse.json({ scenario });
  } catch (err) {
    console.error("Scenario generation failed", err);
    return NextResponse.json(
      { error: "Scenario generation failed" },
      { status: 500 }
    );
  }
}
