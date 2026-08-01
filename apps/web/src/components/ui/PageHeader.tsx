import Link from 'next/link'
import React from 'react'
import { ChevronRight } from 'lucide-react'
import styles from './primitives.module.css'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: BreadcrumbItem[]
  actions?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  children,
}: PageHeaderProps) {
  const actionContent = actions || children

  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className={styles.breadcrumbs} aria-label="面包屑导航">
            {breadcrumbs.map((item, index) => (
              <React.Fragment key={`${item.label}-${index}`}>
                {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                {item.href ? (
                  <Link className={styles.breadcrumbLink} href={item.href}>
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page">{item.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className={styles.pageTitle}>{title}</h1>
        {description && <p className={styles.pageDescription}>{description}</p>}
      </div>
      {actionContent && <div className={styles.pageActions}>{actionContent}</div>}
    </header>
  )
}
