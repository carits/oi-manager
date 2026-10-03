import unifiedStyles from './SessionUnavailable.unified.module.css'

export function SessionUnavailable({
  message,
  requestId,
}: {
  message: string
  requestId?: string
}) {
  return (
    <main className={unifiedStyles.u1}>
      <section role="alert" className={unifiedStyles.u2}>
        <h1 className={unifiedStyles.u3}>暂时无法确认登录状态</h1>
        <p className={unifiedStyles.u4}>{message}</p>
        {requestId && (
          <details className={unifiedStyles.u5}>
            <summary>诊断信息</summary>
            <code>请求编号：{requestId}</code>
          </details>
        )}
        <a
          href=""
          className={unifiedStyles.u6}
        >
          重试
        </a>
      </section>
    </main>
  )
}
