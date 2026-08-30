// lib/npc/enforcePersonaSafety.ts
//
// Phase 6：生成的人设卡真正落库前的最后一道关卡，两条NPC生成路径
// （独立创建入口 app/api/npc/create、场景涌现 app/api/event/start）
// 都要在insert前调这个函数，共用同一套"审核->留底->发信->拒绝"逻辑，
// 不在两个route里各写一份、容易一边改了一边忘。
//
// 这个模块本身不做"生成"，也不做真正的NPC落库insert——只负责判定+副作用。

import { moderatePersona } from "./moderatePersona";
import { insertModerationFlag } from "../db/moderationFlags";
import { sendModerationFlagEmail } from "../email/notifyModerationFlag";
import { getUserEmail } from "../db/users";
import type { NpcPersona } from "./types";

/** 玩家/前端只应该看到"这个人设暂时无法创建"这类通用提示——
 *  抛这个专门的错误类型，方便route.ts精确区分"被审核拦下"和其他失败原因，
 *  分别返回不同的响应，而不用靠字符串匹配错误信息。 */
export class PersonaRejectedError extends Error {
  constructor() {
    super("PERSONA_REJECTED");
    this.name = "PersonaRejectedError";
  }
}

export async function enforcePersonaSafety(params: {
  userId: string;
  rawInput: string;
  displayName: string;
  persona: NpcPersona;
}): Promise<void> {
  const result = await moderatePersona(params.displayName, params.persona, params.rawInput);
  if (!result.flagged) return;

  const userEmail = await getUserEmail(params.userId).catch(() => null);

  await insertModerationFlag({
    userId: params.userId,
    rawInput: params.rawInput,
    displayName: params.displayName,
    persona: params.persona as unknown as Record<string, unknown>,
    reasons: result.reasons,
  }).catch((err) => {
    // 写库失败是更严重的问题，但不能让它盖过"这份人设本就该被拒绝"这件事——
    // 记进日志，人工去Vercel Logs查，主流程照样往下走去发邮件+拒绝。
    console.error("写入npc_moderation_flags失败", err);
  });

  await sendModerationFlagEmail({
    userId: params.userId,
    userEmail,
    rawInput: params.rawInput,
    displayName: params.displayName,
    persona: params.persona as unknown as Record<string, unknown>,
    reasons: result.reasons,
  });

  throw new PersonaRejectedError();
}
