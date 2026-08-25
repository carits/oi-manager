import { forwardRef } from 'react'

export const TableRoot = forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(function TableRoot(props, ref) {
  return <table ref={ref} {...props} />
})
export const TableHead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(function TableHead(props, ref) {
  return <thead ref={ref} {...props} />
})
export const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(function TableBody(props, ref) {
  return <tbody ref={ref} {...props} />
})
export const TableFoot = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(function TableFoot(props, ref) {
  return <tfoot ref={ref} {...props} />
})
export const TableRow = forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(function TableRow(props, ref) {
  return <tr ref={ref} {...props} />
})
export const TableHeaderCell = forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(function TableHeaderCell(props, ref) {
  return <th ref={ref} {...props} />
})
export const TableCell = forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(function TableCell(props, ref) {
  return <td ref={ref} {...props} />
})
export const TableCaption = forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(function TableCaption(props, ref) {
  return <caption ref={ref} {...props} />
})
