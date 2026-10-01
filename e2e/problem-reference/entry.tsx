import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReferenceHarnessContext } from './browser-shims'
import { ProblemReferenceSelector, ProblemReferenceLink, type AddProblemReferences, type SelectedCanonicalProblem } from '../../apps/web/src/features/problem-selection'
import { Button } from '../../apps/web/src/components/ui/Button'
import { Select } from '../../apps/web/src/components/ui/FormControls'
import '../../apps/web/src/styles/globals.css'
import './harness.css'

const hosts = ['训练创建', '训练设计', '训练追加', '比赛', '作业', '题单']

function Harness() {
  const [host, setHost] = useState('训练创建')
  const [scope, setScope] = useState('personal')
  const [target, setTarget] = useState('stage-a')
  const [disabled, setDisabled] = useState(false)
  const [visible, setVisible] = useState(true)
  const [mode, setMode] = useState('all')
  const [selected, setSelected] = useState<SelectedCanonicalProblem[]>([])
  const [calls, setCalls] = useState(0)
  const [submits, setSubmits] = useState(0)
  const attempts = useRef(0)
  const delayed = useRef<Array<() => void>>([])
  const pathname = scope === 'personal' ? '/personal/training-sessions'
    : scope === 'admin' ? '/admin/contests' : `/org/${scope}/training-sessions`
  const onAdd: AddProblemReferences = async (references, operation) => {
    setCalls(current => current + 1)
    attempts.current += 1
    const attempt = attempts.current
    if (mode === 'delayed') await new Promise<void>(resolve => delayed.current.push(resolve))
    if (!operation.isCurrent()) return { acceptedIds: [] }
    if (mode === 'error') throw new Error('业务暂时不可用，题号已保留')
    const accepted = mode === 'partial' && attempt === 1 ? references.slice(0, 1) : references
    const acceptedProblems = accepted.map(reference => reference.problem)
    setSelected(current => [...current, ...acceptedProblems.filter(problem => !current.some(item => item.id === problem.id))])
    return {
      acceptedIds: acceptedProblems.map(problem => problem.id),
      rejected: references.filter(reference => !accepted.includes(reference)).map(reference => ({ id: reference.problem.id, message: '该题详情加载失败，可重试' })),
    }
  }
  return <ReferenceHarnessContext.Provider value={{ sessionKey: `${scope}:tester`, user: { userId: 'tester', accountRole: scope === 'admin' ? 'super_admin' : 'user' }, pathname }}>
    <main>
      <h1>题目引用组件浏览器验证</h1>
      <div className="harness-controls">
        <label>业务入口<Select aria-label="业务入口" value={host} onChange={event => { setHost(event.target.value); setSelected([]) }}>{hosts.map(value => <option key={value}>{value}</option>)}</Select></label>
        <label>工作区<Select aria-label="工作区" value={scope} onChange={event => { setScope(event.target.value); setSelected([]); window.history.replaceState(null, '', event.target.value === 'personal' ? '/personal/training-sessions' : event.target.value === 'admin' ? '/admin/contests' : `/org/${event.target.value}/training-sessions`) }}><option value="personal">个人空间</option><option value="org-a">学校 A</option><option value="org-b">学校 B</option><option value="admin">超级管理员</option></Select></label>
        <label>接收模式<Select aria-label="接收模式" value={mode} onChange={event => { setMode(event.target.value); attempts.current = 0 }}><option value="all">全部成功</option><option value="partial">首次部分失败</option><option value="error">业务失败</option><option value="delayed">异步等待</option></Select></label>
        <Button type="button" onClick={() => setDisabled(value => !value)}>切换禁用</Button>
        <Button type="button" onClick={() => setVisible(value => !value)}>切换挂载</Button>
        <Button type="button" onClick={() => { setTarget(value => value === 'stage-a' ? 'stage-b' : 'stage-a'); setSelected([]) }}>切换阶段</Button>
        <Button type="button" onClick={() => { delayed.current.splice(0).forEach(resolve => resolve()) }}>完成异步添加</Button>
        <Button type="button" onClick={() => setSelected(current => [...current, { id: 'local-carits-A', platform: 'carits', problemId: 'A', title: '题目 carits A' }])}>外部选入 A</Button>
      </div>
      <div id="host" className="harness-host">
        <form onSubmit={event => { event.preventDefault(); setSubmits(current => current + 1) }}>
          {visible && <ProblemReferenceSelector contextKey={`${host}:${target}`} dataRequirement={host === '比赛' || host === '作业' ? 'stable' : host === '题单' ? 'none' : 'training'} existingProblemIds={selected.map(problem => problem.id)} disabled={disabled} onAdd={onAdd} />}
        </form>
      </div>
      <p>接收调用：<output data-testid="add-calls">{calls}</output>；父表单提交：<output data-testid="form-submits">{submits}</output></p>
      <ul data-testid="selected">{selected.map(problem => <li key={problem.id}><ProblemReferenceLink problem={problem} /></li>)}</ul>
    </main>
  </ReferenceHarnessContext.Provider>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
