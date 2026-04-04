/**
 * ai-translate 模块统一导出
 */

export { translateDocument, formatDocument } from './translate'
export { protect, protectFull, protectSampleBlocks, resetCounter } from './protect'
export { restore, restoreAndVerify, findResidualPlaceholders } from './restore'
export { splitText } from './splitter'
export { getGlossary, getPlatformRules, formatGlossaryForPrompt } from './glossary'
export { buildSystemPrompt, buildUserPrompt, buildFormatPrompt } from './prompt'
export { callDeepSeek, resetClient } from './deepseek'
export { validate } from './validate'
export { TranslationCache, getTranslationCache, resetCache } from './cache'

export type * from './types'
