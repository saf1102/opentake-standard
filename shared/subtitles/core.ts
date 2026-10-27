export type TimedSubtitleWord = {
  id?: string;
  text: string;
  start: number;
  end: number;
};

export type DerivedSubtitleCue<TWord extends TimedSubtitleWord = TimedSubtitleWord> = {
  start: number;
  end: number;
  text: string;
  words: TWord[];
};

export type SubtitleSegmentationOptions = {
  maxUnits?: number;
  minUnits?: number;
  pause?: number;
  minWords?: number;
  maxWords?: number;
};

const meaningful = (value: string) => /[\p{L}\p{N}]/u.test(value);
const hardStop = (value: string) => /[。！？!?；;]/u.test(value);
const softStop = (value: string) => /[，,、：:]/u.test(value);
const phraseStop = (value: string) => /[的地得了着过吗呢吧啊呀啦也]$/u.test(value.trim());
const explicitPhraseStop = (value: string) =>
  /(给我|给你|给他|给她|给大家|这么做|这样做|然后|接着|首先|其次|最后)$/u.test(
    value.trim(),
  );
const hasCjk = (value: string) => /[\p{Script=Han}]/u.test(value);
const hasAsciiWord = (value: string) => /[A-Za-z0-9]/u.test(value);

export function cleanSubtitleDisplayText(value: string) {
  const chars = Array.from(value.trim());
  return chars
    .filter((char, index) => {
      if (!/[，。！？；：、,.!?;:]/u.test(char)) return true;
      // Product/version names such as Seedance 2.5 keep their decimal point.
      return (
        char === "." &&
        /\d/u.test(chars[index - 1] || "") &&
        /\d/u.test(chars[index + 1] || "")
      );
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

export function subtitleTextUnits(value: string) {
  return Array.from(value).reduce((total, char) => {
    if (/\s/u.test(char)) return total;
    if (/[\p{P}\p{S}]/u.test(char)) return total + 0.42;
    if (char.charCodeAt(0) <= 0x7f) return total + 0.56;
    return total + 1;
  }, 0);
}

/**
 * Join ASR tokens without introducing spaces into Chinese, while still making
 * independently-trimmed Latin word tokens readable. Existing whitespace from
 * the recogniser is respected and punctuation never gets a synthetic space.
 */
type JoinableSubtitleWord = Pick<TimedSubtitleWord, "text"> &
  Partial<Pick<TimedSubtitleWord, "start" | "end">>;

function compactAsciiCharacterTokens(words: ReadonlyArray<JoinableSubtitleWord>) {
  const meaningfulWords = words.filter((word) => /[A-Za-z0-9]/u.test(word.text));
  if (meaningfulWords.length < 4) return false;
  const singleCharacters = meaningfulWords.filter(
    (word) => Array.from(word.text.trim()).length === 1,
  );
  return singleCharacters.length / meaningfulWords.length >= 0.8;
}

function joinSubtitleWordsWithMode(
  words: ReadonlyArray<JoinableSubtitleWord>,
  compactAscii: boolean,
) {
  let output = "";
  for (const word of words) {
    const raw = word.text;
    if (!raw) continue;
    const text = raw.trim();
    if (!text) continue;
    const previous = output[output.length - 1] || "";
    const first = text[0] || "";
    const needsLatinSpace =
      output.length > 0 &&
      !compactAscii &&
      !/\s/u.test(raw[0] || "") &&
      /[A-Za-z0-9]/u.test(previous) &&
      /[A-Za-z0-9]/u.test(first);
    output += `${needsLatinSpace ? " " : ""}${text}`;
  }
  return output.trim();
}

export function joinSubtitleWords(words: ReadonlyArray<JoinableSubtitleWord>) {
  return joinSubtitleWordsWithMode(words, compactAsciiCharacterTokens(words));
}

/**
 * Shared caption grouping for the recording side and the editing side.
 *
 * Chinese and mixed-language speech use visual width, punctuation, phrase
 * boundaries and acoustic pauses. Whitespace-delimited languages additionally
 * honour the recording-side min/max word controls. Timing always comes from the
 * source words; this function only decides which words share one visible cue.
 */
export function segmentTimedWordsForDisplay<TWord extends TimedSubtitleWord>(
  input: TWord[],
  options: SubtitleSegmentationOptions = {},
): Array<DerivedSubtitleCue<TWord>> {
  const maxUnits = options.maxUnits ?? 17;
  const minUnits = options.minUnits ?? 4.5;
  const pause = options.pause ?? 0.65;
  const minWords = Math.max(1, Math.floor(options.minWords ?? 2));
  const maxWords = Math.max(minWords, Math.floor(options.maxWords ?? 7));
  const words = input
    .filter((word) => word.text.trim() && word.end >= word.start)
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const usesCjkRules = words.some((word) => hasCjk(word.text));
  const compactAscii = compactAsciiCharacterTokens(words);
  const joinWords = (items: TWord[]) => joinSubtitleWordsWithMode(items, compactAscii);
  const cues: Array<DerivedSubtitleCue<TWord>> = [];
  let buffer: TWord[] = [];

  const pushCue = (cueWords: TWord[]) => {
    if (!cueWords.length) return;
    const rawText = joinWords(cueWords);
    const text = cleanSubtitleDisplayText(rawText);
    if (text && meaningful(text)) {
      cues.push({
        start: cueWords[0].start,
        end: Math.max(cueWords[0].start + 0.12, cueWords[cueWords.length - 1].end),
        text,
        words: cueWords,
      });
      return;
    }
    if (rawText && cues.length) {
      const previous = cues[cues.length - 1];
      previous.end = Math.max(previous.end, cueWords[cueWords.length - 1].end);
      previous.words.push(...cueWords);
    }
  };

  const flush = () => {
    if (!buffer.length) return;
    pushCue(buffer);
    buffer = [];
  };

  const safeBoundary = (index: number) => {
    const word = buffer[index];
    const next = buffer[index + 1];
    if (!word || !next) return false;
    const gap = next.start - word.end;
    const prefixUnits = subtitleTextUnits(joinWords(buffer.slice(0, index + 1)));
    return (
      gap >= 0.12 ||
      explicitPhraseStop(word.text) ||
      (phraseStop(word.text) && prefixUnits >= 9) ||
      (hasCjk(word.text) && hasAsciiWord(next.text)) ||
      (hasAsciiWord(word.text) && hasCjk(next.text))
    );
  };

  const splitLongPhraseAtSafeBoundary = () => {
    const totalUnits = subtitleTextUnits(joinWords(buffer));
    if (totalUnits <= maxUnits) return;
    let splitAt = -1;
    let bestBalance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < buffer.length - 1; candidate++) {
      const prefixUnits = subtitleTextUnits(
        joinWords(buffer.slice(0, candidate + 1)),
      );
      if (
        prefixUnits >= minUnits &&
        prefixUnits <= maxUnits + 1.5 &&
        safeBoundary(candidate)
      ) {
        const balance = Math.abs(prefixUnits - totalUnits / 2);
        if (balance < bestBalance) {
          bestBalance = balance;
          splitAt = candidate + 1;
        }
      }
    }
    if (splitAt > 0) {
      pushCue(buffer.slice(0, splitAt));
      buffer = buffer.slice(splitAt);
    }
  };

  words.forEach((word, index) => {
    const next = words[index + 1];
    buffer.push(word);
    const text = joinWords(buffer);
    const units = subtitleTextUnits(text);
    const gap = next ? next.start - word.end : Number.POSITIVE_INFINITY;
    const latinWordLimit = !usesCjkRules && buffer.length >= maxWords;
    const pauseBoundary =
      gap >= pause * 1.75 ||
      (gap >= pause && (usesCjkRules ? units >= minUnits : buffer.length >= minWords));
    const shouldBreak =
      hardStop(word.text) ||
      (softStop(word.text) && units >= 3.5) ||
      pauseBoundary ||
      latinWordLimit ||
      units >= maxUnits * 2.4;
    if (shouldBreak) {
      splitLongPhraseAtSafeBoundary();
      flush();
    } else {
      splitLongPhraseAtSafeBoundary();
    }
  });
  flush();

  for (let index = cues.length - 1; index >= 0; index--) {
    const cue = cues[index];
    const isTiny = usesCjkRules
      ? subtitleTextUnits(cue.text) < 2.5
      : cue.words.length < minWords;
    if (!isTiny || cues.length === 1) continue;
    const previous = cues[index - 1];
    const next = cues[index + 1];
    if (
      previous &&
      cue.start - previous.end < pause &&
      subtitleTextUnits(`${previous.text}${cue.text}`) <= maxUnits + 2
    ) {
      previous.text = cleanSubtitleDisplayText(joinWords([...previous.words, ...cue.words]));
      previous.end = cue.end;
      previous.words.push(...cue.words);
      cues.splice(index, 1);
    } else if (
      next &&
      next.start - cue.end < pause &&
      subtitleTextUnits(`${cue.text}${next.text}`) <= maxUnits + 2
    ) {
      next.text = cleanSubtitleDisplayText(joinWords([...cue.words, ...next.words]));
      next.start = cue.start;
      next.words.unshift(...cue.words);
      cues.splice(index, 1);
    }
  }

  return cues;
}
