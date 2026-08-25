import { forwardRef, useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import styles from './primitives.module.css'

type InputProps = React.InputHTMLAttributes<HTMLInputElement>
type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>
type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`${styles.formControl} ${className}`.trim()} {...props} />
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`${styles.formControl} ${className}`.trim()} {...props} />
})
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className = '', children, ...props }, ref) {
  return <select ref={ref} className={`${styles.formControl} ${styles.selectControl} ${className}`.trim()} {...props}>{children}</select>
})

export function Checkbox({ label, description, className = '', ...props }: InputProps & { label: string; description?: string }) {
  const generatedId = useId()
  const id = props.id || generatedId
  return <label className={`${styles.choiceControl} ${className}`.trim()} htmlFor={id}><input {...props} id={id} type="checkbox" /><span><strong>{label}</strong>{description && <small>{description}</small>}</span></label>
}

export function Switch({ label, description, checked, onChange, disabled, id: providedId }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; id?: string }) {
  const generatedId = useId()
  const id = providedId || generatedId
  return <label className={styles.switchControl} htmlFor={id}><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

export function RadioGroup<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ value: T; label: string; description?: string }>; onChange: (value: T) => void; disabled?: boolean }) {
  const name = useId()
  return <fieldset className={styles.radioGroup} disabled={disabled}><legend>{label}</legend>{options.map(option => <label key={option.value} className={styles.choiceControl}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>)}</fieldset>
}

export const SearchField = forwardRef<HTMLInputElement, InputProps>(function SearchField({ className = '', ...props }, ref) {
  return <label className={`${styles.searchField} ${className}`.trim()}><Search size={16} aria-hidden="true" /><input ref={ref} type="search" {...props} /></label>
})

export interface ComboboxOption { value: string; label: string; description?: string }
export function Combobox({ value, options, onChange, placeholder = '请选择', searchPlaceholder = '搜索', disabled }: { value?: string; options: ComboboxOption[]; onChange: (value: string) => void; placeholder?: string; searchPlaceholder?: string; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value)
  const visible = useMemo(() => options.filter(option => `${option.label} ${option.description || ''}`.toLowerCase().includes(query.toLowerCase())), [options, query])
  return <div className={styles.combobox}><button type="button" className={styles.comboboxTrigger} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}>{selected?.label || placeholder}<span aria-hidden="true">⌄</span></button>{open && <div className={styles.comboboxPanel}><SearchField autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} /><div role="listbox" className={styles.comboboxOptions}>{visible.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); setQuery('') }}><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</button>)}{visible.length === 0 && <p>没有匹配项</p>}</div></div>}</div>
}
