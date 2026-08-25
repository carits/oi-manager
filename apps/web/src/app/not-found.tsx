import Link from 'next/link'
import unifiedStyles from './not-found.unified.module.css'

export default function NotFound() {
  return (
    <main className={unifiedStyles.u1}>
      <p className={unifiedStyles.u2}>404</p>
      <h1 className={unifiedStyles.u3}>页面不存在</h1>
      <p className={unifiedStyles.u4}>
        地址可能已经变更，或者当前账号没有对应的页面入口。
      </p>
      <Link href="/" className={unifiedStyles.u5}>返回首页</Link>
    </main>
  )
}
