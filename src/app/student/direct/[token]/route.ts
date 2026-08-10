import { redirect } from 'next/navigation'
import { clearAdminSession } from '@/lib/admin-auth'
import { createStudentSession } from '@/lib/student-auth'
import { consumeStudentDirectAccessToken } from '@/lib/student-direct-links'

type StudentDirectRouteProps = {
  params: Promise<{ token: string }>
}

export async function GET(_request: Request, { params }: StudentDirectRouteProps) {
  const { token } = await params

  if (!token) {
    redirect('/?error=access-link')
  }

  const accessLink = await consumeStudentDirectAccessToken(token)

  if (!accessLink?.student_id || !accessLink.lesson_part_id) {
    redirect('/?error=access-link')
  }

  await clearAdminSession()
  await createStudentSession(accessLink.student_id)
  redirect(`/student/lesson/${accessLink.lesson_part_id}`)
}
