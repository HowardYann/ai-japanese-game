// lib/chat/extractWordChunks.ts
//
// buildContext.ts里的"组句辅助"规则要求AI在触发时，把词块放进回应最后一行的
// [[CHUNKS: 词块1|词块2|词块3]] 标记里，跟角色台词分开。
// 这个模块负责把这个标记从原始文本里摘出来，返回：
//   - reply: 去掉标记之后、纯净的角色台词（存进DB、显示在对话气泡里的就是这个）
//   - wordChunks: 词块数组；这一轮没触发组句辅助就是 null
//
// 只做字符串处理，不依赖AI严格遵守"标记必须在最后一行"——用不带$锚点的正则，
// 容忍模型偶尔把标记放的位置不完全在末尾，只要格式本身对就能识别。

export interface ExtractedReply {
  reply: string;
  wordChunks: string[] | null;
}

const CHUNK_MARKER_RE = /\[\[CHUNKS:\s*([^\]]*)\]\]/i;

export function extractWordChunks(rawText: string): ExtractedReply {
  const trimmedRaw = rawText.trim();
  const match = trimmedRaw.match(CHUNK_MARKER_RE);

  if (!match) {
    return { reply: trimmedRaw, wordChunks: null };
  }

  const chunks = match[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const withoutMarker = (
    trimmedRaw.slice(0, match.index) +
    trimmedRaw.slice((match.index ?? 0) + match[0].length)
  ).trim();

  return {
    // 兜底：万一AI整条回应就只有标记本身（没有正常台词），
    // 别把台词吃成空字符串——保留原文，让玩家至少看到点东西，而不是空气泡。
    reply: withoutMarker || trimmedRaw,
    wordChunks: chunks.length > 0 ? chunks : null,
  };
}
