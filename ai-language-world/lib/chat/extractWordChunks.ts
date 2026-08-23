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
  suggestClose: boolean;
}

const CHUNK_MARKER_RE = /\[\[CHUNKS:\s*([^\]]*)\]\]/i;
const SUGGEST_CLOSE_RE = /\[\[SUGGEST_CLOSE\]\]/i;

export function extractWordChunks(rawText: string): ExtractedReply {
  let text = rawText.trim();

  const suggestClose = SUGGEST_CLOSE_RE.test(text);
  text = text.replace(SUGGEST_CLOSE_RE, "").trim();

  const match = text.match(CHUNK_MARKER_RE);
  if (!match) {
    return { reply: text, wordChunks: null, suggestClose };
  }

  const chunks = match[1].split("|").map((s) => s.trim()).filter(Boolean);
  const withoutMarker = (
    text.slice(0, match.index) + text.slice((match.index ?? 0) + match[0].length)
  ).trim();

  return {
    reply: withoutMarker || text,
    wordChunks: chunks.length > 0 ? chunks : null,
    suggestClose,
  };
}
