import type { HTMLAttributes, ReactNode } from 'react'
import styles from './primitives.module.css'

export function Section({ title, description, actions, children, className = '', ...props }: HTMLAttributes<HTMLElement> & { title?: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className={`${styles.section} ${className}`.trim()} {...props}>{(title || description || actions) && <header className={styles.sectionHeader}><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div className={styles.sectionActions}>{actions}</div>}</header>}<div className={styles.sectionBody}>{children}</div></section>
}
