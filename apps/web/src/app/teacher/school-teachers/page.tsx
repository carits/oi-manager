import { redirect } from 'next/navigation'

export default function SchoolTeachersPage() {
  redirect('/teacher/school?tab=teachers')
}
