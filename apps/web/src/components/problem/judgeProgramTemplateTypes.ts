export type JudgeProgramKind = 'standard' | 'validator' | 'classifier' | 'generator'

export type JudgeProgramFixture = {
  name: string
  stdin: string
  expectedExitCode?: number
  expectedStdout?: string
  expectedSubtasks?: number[]
}

export type ParameterRule = {
  type: 'integer' | 'number' | 'string' | 'boolean'
  default?: string | number | boolean
  minimum?: number
  maximum?: number
  enum?: Array<string | number | boolean>
}

export type GeneratorProtocolConfig = {
  profiles: Array<{ id: string; label: string; params: Record<string, string | number | boolean> }>
  parameterSchema: Record<string, ParameterRule>
}

export type ProgramTemplateSummary = {
  id: string
  version: number
  kind: JudgeProgramKind
  language: string
  protocol: string
  title: string
  description: string
  recommended: boolean
  protocolHelp: string[]
  fixtureCount: number
  profileCount: number
  hasProtocolConfig: boolean
  learningNoteCount: number
  requiredChangeCount: number
}

export type ProgramTemplate = Omit<ProgramTemplateSummary, 'fixtureCount' | 'profileCount' | 'hasProtocolConfig' | 'learningNoteCount' | 'requiredChangeCount'> & {
  source: string
  examples: JudgeProgramFixture[]
  protocolConfig?: GeneratorProtocolConfig
  learningNotes: string[]
  requiredChanges: string[]
}

export type ProgramCatalog = {
  capabilities: Record<JudgeProgramKind, {
    title: string
    description: string
    defaultLanguage: string
    languages: Record<string, string[]>
    quickProtocol: string[]
  }>
  templates: ProgramTemplateSummary[]
}
