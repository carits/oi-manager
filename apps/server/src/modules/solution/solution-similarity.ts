const CJK = /[\u3400-\u9fff]/u
const WORD = /[\p{L}\p{N}_]/u

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  return Math.round(intersection * 10_000 / (left.size + right.size - intersection))
}

function shingles(tokens: string[], width: number) {
  const result = new Set<string>()
  if (tokens.length < width) {
    if (tokens.length) result.add(tokens.join('\u0001'))
    return result
  }
  for (let index = 0; index <= tokens.length - width; index += 1) {
    result.add(tokens.slice(index, index + width).join('\u0001'))
  }
  return result
}

export function markdownFingerprint(markdown: string) {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .normalize('NFKC').toLowerCase()
  const tokens: string[] = []
  let word = ''
  for (const char of plain) {
    if (CJK.test(char)) {
      if (word) tokens.push(word), word = ''
      tokens.push(char)
    } else if (WORD.test(char)) word += char
    else if (word) tokens.push(word), word = ''
  }
  if (word) tokens.push(word)
  return shingles(tokens, 5)
}

const CPP_KEYWORDS = new Set('alignas alignof and asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long namespace new noexcept not nullptr operator or private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile wchar_t while'.split(' '))

export function codeFingerprint(code: string | null | undefined) {
  if (!code) return new Set<string>()
  const clean = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' STR ')
    .normalize('NFKC').toLowerCase()
  const identifiers = new Map<string, string>()
  const tokens = clean.match(/[a-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||<<|>>|[-+*/%<>{}()[\];,.=&|!?:]/g) || []
  const normalized = tokens.map(token => {
    if (/^\d/.test(token)) return 'NUM'
    if (!/^[a-z_]\w*$/.test(token) || CPP_KEYWORDS.has(token)) return token
    if (!identifiers.has(token)) identifiers.set(token, `ID${identifiers.size}`)
    return identifiers.get(token)!
  })
  return shingles(normalized, 7)
}

export function compareSolutionContent(
  subject: { contentMarkdown: string; referenceCode?: string | null },
  candidate: { contentMarkdown: string; referenceCode?: string | null },
) {
  const textSimilarityBasisPoints = jaccard(markdownFingerprint(subject.contentMarkdown), markdownFingerprint(candidate.contentMarkdown))
  const codeSimilarityBasisPoints = jaccard(codeFingerprint(subject.referenceCode), codeFingerprint(candidate.referenceCode))
  const maximumSimilarityBasisPoints = Math.max(textSimilarityBasisPoints, codeSimilarityBasisPoints)
  return { textSimilarityBasisPoints, codeSimilarityBasisPoints, maximumSimilarityBasisPoints }
}

export function similarityRisk(score: number) {
  return score >= 8500 ? 'HIGH' as const : score >= 6500 ? 'MEDIUM' as const : 'LOW' as const
}
