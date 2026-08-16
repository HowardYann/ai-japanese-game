// lib/claude/client.ts
//
// 安全纪律 #2：AI不做tool calling去查库/查文件。
// 这个模块只做一件事：拿组装好的 system prompt + messages，调对应厂商的API，
// 把纯文本回应吐回去。没有 tools 参数，没有数据库连接。
//
// 支持多供应商切换（方便用免费额度测试），通过 AI_PROVIDER 环境变量控制：
//   - "anthropic"（默认）：走 Claude API，需要 ANTHROPIC_API_KEY
//   - "openai_compatible"：走任何OpenAI兼容的 /chat/completions 接口，
//     可以指向 Groq、OpenRouter，或本地 Ollama 等——这些大多有免费额度或完全免费。
//     需要 AI_BASE_URL、AI_API_KEY、AI_MODEL
//
// 上层调用方（app/api/chat/route.ts）不需要关心具体是哪家，接口不变。

import type { ClaudeMessage } from "../context/buildContext";

type Provider = "anthropic" | "openai_compatible";

function getProvider(): Provider {
  const p = process.env.AI_PROVIDER;
  return p === "openai_compatible" ? "openai_compatible" : "anthropic";
}

// ---------- Anthropic (Claude) ----------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// 优先读 CLAUDE_MODEL，没设置就默认 Sonnet。
// 测试阶段可设 CLAUDE_MODEL=claude-haiku-4-5-20251001 省钱。
const ANTHROPIC_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

async function callAnthropic(
  systemPrompt: string,
  messages: ClaudeMessage[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY env var");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048, // 同上：给足余量，避免schema再变大又要回来调这个数字
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // content 是一个 block 数组，MVP阶段只取纯文本块并拼接
  const text = (data.content ?? [])
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic returned no text content");
  }

  return text;
}

// ---------- OpenAI兼容接口（Groq / OpenRouter / Ollama 等） ----------
//
// 这些厂商的 chat/completions 接口格式基本一致，跟Claude的差异主要是：
// system prompt 是 messages 数组里的第一条，而不是单独的字段。
//
// 常见免费端点参考（额度/条款以各家最新文档为准）：
//   Groq:       https://api.groq.com/openai/v1/chat/completions
//   OpenRouter: https://openrouter.ai/api/v1/chat/completions

async function callOpenAiCompatible(
  systemPrompt: string,
  messages: ClaudeMessage[]
): Promise<string> {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      "openai_compatible provider需要设置 AI_BASE_URL、AI_API_KEY、AI_MODEL"
    );
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048, // 给足余量——生成的token不会多算钱（大部分供应商按实际生成量计费），设高一点比反复调数字更省心
      // 针对 openai/gpt-oss-20b、openai/gpt-oss-120b 这类推理模型：
      // 默认reasoning_effort是medium，会在"隐藏思考"上花掉不少token，
      // 挤压真正要输出的JSON。这个任务不需要深度推理，调低更聚焦、也更省。
      // 注意：这个参数是Groq对gpt-oss系列的扩展字段，如果换成别家/别的模型，
      // 大概率会被直接忽略，不影响调用，但没必要的话可以删掉。
      reasoning_effort: "low",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI兼容接口 error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  const finishReason = choice?.finish_reason;

  if (!text) {
    // 明确区分"被截断"和"其他原因返回空"——以后不管哪种，日志里直接写清楚，
    // 不用每次都要重新对着原始响应体猜
    if (finishReason === "length") {
      throw new Error(
        `OpenAI兼容接口输出被截断（max_tokens不够，finish_reason=length）——需要调大max_tokens`
      );
    }
    // Groq对gpt-oss系列的推理内容放在 message.reasoning 字段（不是更常见的
    // reasoning_content），之前这里检测错了字段名，实际从没生效过
    const reasoningFallback = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
    console.error("OpenAI兼容接口返回空content，完整响应：", JSON.stringify(data).slice(0, 2000));
    throw new Error(
      `OpenAI兼容接口返回了空内容（finish_reason=${finishReason ?? "unknown"}）` +
        (reasoningFallback
          ? "；检测到推理字段里有内容——这个模型把token都花在思考上、没能力/没token数写出最终答案了，需要调低reasoning_effort或调大max_tokens"
          : "")
    );
  }

  return text;
}

// ---------- 对外统一入口 ----------

export async function callClaude(
  systemPrompt: string,
  messages: ClaudeMessage[]
): Promise<string> {
  const provider = getProvider();
  return provider === "openai_compatible"
    ? callOpenAiCompatible(systemPrompt, messages)
    : callAnthropic(systemPrompt, messages);
}
