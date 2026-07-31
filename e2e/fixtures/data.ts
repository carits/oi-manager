import fs from 'node:fs'
import path from 'node:path'

export interface FixtureIds {
  users: {
    superAdmin: string
    platformAdmin: string
    principal: string
    teacher: string
    campusStudent: string
    personalStudent: string
  }
  school: string
  team: string
  personalTeam: string
  problem: string
  personalProblem: string
  problemList: string
  homework: string
  contest: string
  submission: string
  personalSubmission: string
}

export function loadFixtureIds(): FixtureIds {
  const fixturePath = path.resolve(__dirname, '../../test-results/e2e-fixtures.json')
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing ${fixturePath}. Run pnpm test:ui:prepare first.`)
  }
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as FixtureIds
}
