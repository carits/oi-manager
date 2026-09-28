import { createContext, useContext, type AnchorHTMLAttributes } from 'react'

export const ReferenceHarnessContext = createContext({
  sessionKey: 'personal:tester',
  user: { userId: 'tester', accountRole: 'user' },
  pathname: '/personal/training-sessions',
})
export function useAuth() { return useContext(ReferenceHarnessContext) }
export function usePathname() { return useContext(ReferenceHarnessContext).pathname }
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} /> }
