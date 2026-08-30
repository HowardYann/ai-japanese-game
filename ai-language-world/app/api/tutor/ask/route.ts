// app/api/tutor/ask/route.ts
//
// Phase 8（AI Tutor）：玩家点开某一句NPC台词问问题时调这个接口。
//
// 跟 /api/chat 是两条独立的链路：
// - 不写 conversation_turns（这不是"正式对话历史"，是随时可关闭的解释层，
//   见 buildTutorContext.ts 顶部注释），也不影响 task_state / relationship。
// - 追问链条（priorQA）完全由前端在内存里维护、原样传回来，服务端不落库、
//   不跨请求记忆——玩家关掉这个小面板，这条追问链条就没了，这是有意为之
//   （对照文档第13节："小、快、可以随时关闭，不应该把用户带离当前世界"）。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { getOwnedEvent, getTurnsForEvent } from "../../../../lib/db/events";
import { getNpcConfigForUser } from "../../../../lib/npc/registryServer";
import { buildTutorContext, type TutorQA } from "../../../../lib/context/buildTutorContext";
import { callClaude } from "../../../../lib/claude/client";

const MAX_MESSAGE_LEN = 500; // targetMessage是NPC台词，正常不会太长，超长大概率不是正常调用
const MAX_QUESTION_LEN = 300;
const MAX_PRIOR_QA = 6; // 跟buildTutorContext.ts里的MAX_PRIOR_QA一致，这里提前截断，避免玩家传一个超长数组把prompt灌爆

function isValidPriorQA(raw: unknown): raw is TutorQA[] {
  if (!Array.isArray(raw)) return false;
  if (raw.length > MAX_PRIOR_QA) return false;
  return raw.every(
    (x) =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as Record<string, unknown>).question === "string" &&
      typeof (x as Record<string, unknown>).answer === "string"
  );
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const eventId = body?.eventId;
  const targetMessage = body?.targetMessage;
  const question = body?.question;
  const priorQA: TutorQA[] = isValidPriorQA(body?.priorQA) ? body.priorQA : [];

  if (!eventId || typeof eventId !== "string") {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }
  if (!targetMessage || typeof targetMessage !== "string" || targetMessage.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: "Invalid targetMessage" }, { status: 400 });
  }
  if (!question || typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION_LEN) {
    return NextResponse.json({ error: "Invalid question" }, { status: 400 });
  }

  try {
    // 归属权校验：这场event是不是这个玩家的——跟其它路由一致的纪律
    const event = await getOwnedEvent(eventId, userId);
    const npc = await getNpcConfigForUser(event.npc_id, userId);
    const recentTurns = await getTurnsForEvent(eventId, userId);

    const { systemPrompt, messages } = buildTutorContext(
      npc,
      event.scenario,
      recentTurns,
      targetMessage.trim(),
      priorQA,
      question.trim()
    );

    const answer = await callClaude(systemPrompt, messages);
    return NextResponse.json({ answer: answer.trim() });
  } catch (err) {
    console.error("Tutor request failed", err);
    return NextResponse.json({ error: "Tutor request failed" }, { status: 500 });
  }
}
