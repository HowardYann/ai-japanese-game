// lib/furigana/toRubyHtml.ts
//
// 把一段日语文本转成带<ruby>注音的HTML片段。
//
// kuromoji给出的是"整个词"的读音（比如"食べます"整体读音たべます），
// 但直接把整个词包一层<ruby>会导致假名部分也被重复标注（"べます"上面又标一遍べます），
// 看起来很怪。所以这里做了一步okurigana剥离：从词的两端把跟读音能对上的
// 假名部分剥掉，只保留中间的汉字部分配注音，前后的假名原样输出。
//
// 例：surface="食べます" reading(转平假名后)="たべます"
//   -> 剥离后：汉字部分"食"配读音"た"，"べます"原样输出

interface KuromojiToken {
  surface_form: string;
  reading?: string;
}

const KANJI_RE = /[\u4e00-\u9fff々〆〤]/;

function katakanaToHiragana(katakana: string): string {
  return katakana.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 把一个token拆成 {汉字部分+读音} 和 {原样文本} 交替的片段 */
function splitOkurigana(
  surface: string,
  readingHiragana: string
): Array<{ text: string; ruby?: string }> {
  if (!KANJI_RE.test(surface)) {
    return [{ text: surface }];
  }

  let start = 0;
  let end = surface.length;
  let readStart = 0;
  let readEnd = readingHiragana.length;

  // 从前往后剥：非汉字字符如果跟读音对得上，说明这部分本来就是假名，不需要注音
  while (
    start < end &&
    readStart < readEnd &&
    !KANJI_RE.test(surface[start]) &&
    surface[start] === readingHiragana[readStart]
  ) {
    start++;
    readStart++;
  }
  // 从后往前剥，同理（这是最常见的okurigana场景，比如"食べます"的"べます"）
  while (
    end > start &&
    readEnd > readStart &&
    !KANJI_RE.test(surface[end - 1]) &&
    surface[end - 1] === readingHiragana[readEnd - 1]
  ) {
    end--;
    readEnd--;
  }

  const segments: Array<{ text: string; ruby?: string }> = [];
  if (start > 0) segments.push({ text: surface.slice(0, start) });

  const kanjiPart = surface.slice(start, end);
  const rubyPart = readingHiragana.slice(readStart, readEnd);
  if (kanjiPart) {
    // rubyPart为空说明剥离算法没能对齐（复合读音、当て字等边界情况），
    // 这种情况宁可不标注也不要标错——直接原样输出这部分，不猜
    segments.push(rubyPart ? { text: kanjiPart, ruby: rubyPart } : { text: kanjiPart });
  }
  if (end < surface.length) segments.push({ text: surface.slice(end) });

  return segments;
}

export function tokensToRubyHtml(tokens: KuromojiToken[]): string {
  let html = "";

  for (const token of tokens) {
    const surface = token.surface_form;
    const rawReading = token.reading;

    if (!rawReading || rawReading === "*" || !KANJI_RE.test(surface)) {
      html += escapeHtml(surface);
      continue;
    }

    const readingHiragana = katakanaToHiragana(rawReading);
    const segments = splitOkurigana(surface, readingHiragana);

    for (const seg of segments) {
      if (seg.ruby) {
        html += `<ruby>${escapeHtml(seg.text)}<rt>${escapeHtml(seg.ruby)}</rt></ruby>`;
      } else {
        html += escapeHtml(seg.text);
      }
    }
  }

  return html;
}
