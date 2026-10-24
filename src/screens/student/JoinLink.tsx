import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { useUserId } from '../../lib/session'
import { joinCourse } from '../../lib/student'
import { cleanJoinCode } from './Courses'

/**
 * Where a course's join QR code leads. Any phone camera can open it, so a
 * student who scans it outside the app still lands in the right course.
 */
export function JoinLink() {
  const { code = '' } = useParams()
  const userId = useUserId()
  const [result, setResult] = useState<{ courseId: string } | { error: string } | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // Strict mode runs effects twice; joining is idempotent, but one request
    // is all it takes.
    if (started.current) return
    started.current = true
    joinCourse(userId, cleanJoinCode(code))
      .then((courseId) => setResult({ courseId }))
      .catch((failure: unknown) =>
        setResult({ error: failure instanceof Error ? failure.message : 'Could not join.' })
      )
  }, [code, userId])

  if (!result) return <Booting />
  if ('courseId' in result) return <Navigate to={`/courses/${result.courseId}`} replace />

  return (
    <div className="pt-6">
      <Empty
        icon={<TriangleAlert size={26} strokeWidth={1.8} />}
        title="Could not join"
        text={result.error}
        action={
          <Link to="/courses" className="btn-secondary">
            Your courses
          </Link>
        }
      />
    </div>
  )
}
