'use server'

import { createPracticeEvent } from '@/lib/practice-data'
import { requireStudentSession } from '@/lib/student-auth'

export async function recordPracticeEvent(input: {
  lessonPartId: number
  completed: boolean
}) {
  const session = await requireStudentSession()
  const { event, error } = await createPracticeEvent({
    studentId: session.id,
    lessonPartId: input.lessonPartId,
    completed: input.completed,
  })

  if (error) {
    throw new Error(error.message)
  }

  return event
}
