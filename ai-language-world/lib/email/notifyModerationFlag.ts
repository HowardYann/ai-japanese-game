// lib/email/notifyModerationFlag.ts
//
// Phase 6：NPC人设审核未通过时，发一封邮件通知开发者本人。
// 直接调Resend自己的HTTP API，跟Supabase Auth用来发magic link那条
// SMTP通道完全独立——那条通道是Supabase Dashboard里配置的，代码碰不到，
// 也没法用来发这种自定义内容的邮件。
//
// 需要的环境变量：
//   RESEND_API_KEY      —— Resend Dashboard -> API Keys 里单独生成
//   MODERATION_NOTIFY_EMAIL —— 收件人（你自己的邮箱）
//   MODERATION_NOTIFY_FROM  —— 可选，发件地址，默认用 ai-language-learning.lol 这个域名下的地址；
//                                这个域名要在Resend里验证过发信权限，不然会发送失败
//
// 发信失败只打日志、不抛错——审核拦截本身（insertModerationFlag已经写库）
// 不应该因为邮件服务临时故障就失败，数据库里的记录才是权威留底，
// 邮件只是"更快让你知道"的锦上添花。

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "NPC审核提醒 <notify@ai-language-learning.lol>";

export async function sendModerationFlagEmail(params: {
  userId: string;
  userEmail: string | null;
  rawInput: string;
  displayName: string;
  persona: Record<string, unknown>;
  reasons: string[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MODERATION_NOTIFY_EMAIL;
  const from = process.env.MODERATION_NOTIFY_FROM || DEFAULT_FROM;

  if (!apiKey || !to) {
    console.error(
      "跳过审核通知邮件发送：缺少 RESEND_API_KEY 或 MODERATION_NOTIFY_EMAIL 环境变量"
    );
    return;
  }

  const html = `
    <h2>NPC生成未通过安全审核</h2>
    <p><b>账号：</b>${escapeHtml(params.userEmail ?? "（未知邮箱）")} (${escapeHtml(params.userId)})</p>
    <p><b>命中原因：</b>${params.reasons.map(escapeHtml).join("；") || "（无具体原因）"}</p>
    <p><b>玩家原始输入：</b></p>
    <pre>${escapeHtml(params.rawInput)}</pre>
    <p><b>生成的人设卡（displayName: ${escapeHtml(params.displayName)}）：</b></p>
    <pre>${escapeHtml(JSON.stringify(params.persona, null, 2))}</pre>
  `;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[安全审核] NPC生成被拦截 - ${params.userEmail ?? params.userId}`,
        html,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Resend发信失败 ${response.status}: ${errText}`);
    }
  } catch (err) {
    console.error("Resend发信请求异常", err);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
