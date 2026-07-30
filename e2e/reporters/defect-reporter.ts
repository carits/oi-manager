import fs from 'node:fs'
import path from 'node:path'
import type {
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

interface Defect {
  title: string
  project: string
  role: string
  severity: 'blocker' | 'high' | 'medium'
  error: string
  attachments: string[]
}

function severityFor(title: string): Defect['severity'] {
  if (/security|permission|judge|maintenance|credential/i.test(title)) return 'blocker'
  if (/route-smoke|renders|core role workflow/i.test(title)) return 'high'
  return 'medium'
}

export default class DefectReporter implements Reporter {
  private defects: Defect[] = []

  onBegin(_config: FullConfig, _suite: Suite) {}

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === test.expectedStatus) return
    const titlePath = test.titlePath()
    const role = titlePath.find(part => /pages$|workflows?$|permission/i.test(part)) || 'unknown'
    this.defects.push({
      title: titlePath.join(' > '),
      project: test.parent.project()?.name || 'unknown',
      role,
      severity: severityFor(titlePath.join(' ')),
      error: result.error?.message?.split('\n').slice(0, 8).join('\n') || result.status,
      attachments: result.attachments
        .map(attachment => attachment.path)
        .filter((attachment): attachment is string => Boolean(attachment)),
    })
  }

  onEnd() {
    const outputDir = path.resolve(process.cwd(), 'test-results')
    fs.mkdirSync(outputDir, { recursive: true })
    const output = path.join(outputDir, 'ui-defects.md')
    const lines = [
      '# UI E2E Defect Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Failures: ${this.defects.length}`,
      '',
    ]

    if (this.defects.length === 0) {
      lines.push('No failures detected.', '')
    } else {
      for (const [index, defect] of this.defects.entries()) {
        lines.push(
          `## ${index + 1}. [${defect.severity.toUpperCase()}] ${defect.title}`,
          '',
          `- Project: \`${defect.project}\``,
          `- Role: \`${defect.role}\``,
          `- Reproduce: \`pnpm exec playwright test --project=${defect.project} -g ${JSON.stringify(defect.title.split(' > ').at(-1))}\``,
          `- Evidence: ${defect.attachments.length ? defect.attachments.map(item => `\`${item}\``).join(', ') : 'none'}`,
          '',
          '```text',
          defect.error,
          '```',
          '',
        )
      }
    }

    fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf8')
  }
}
