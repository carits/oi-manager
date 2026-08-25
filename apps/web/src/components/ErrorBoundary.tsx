'use client'

import { Component, ReactNode } from 'react'
import unifiedStyles from './ErrorBoundary.unified.module.css'
import { Button } from '@/components/ui/Button'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={unifiedStyles.u1}>
          <AlertTriangle
            aria-hidden="true"
            size={44}
            strokeWidth={1.5}
            className={unifiedStyles.u2}
          />
          <h2 className={unifiedStyles.u3}>页面出现错误</h2>
          <p className={unifiedStyles.u4}>
            {this.state.error?.message || '发生了未知错误'}
          </p>
          <Button variant="ghost"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className={unifiedStyles.u5}
          >
            刷新页面
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
