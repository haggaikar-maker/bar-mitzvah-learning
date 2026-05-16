function parseDateOnly(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getTodayDateOnly() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0)
}

export function getDaysUntilReading(readingDate: string | null | undefined) {
  const reading = parseDateOnly(readingDate)

  if (!reading) {
    return null
  }

  const today = getTodayDateOnly()
  const diffMs = reading.getTime() - today.getTime()

  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

export function formatGregorianDate(value: string | null | undefined) {
  const parsed = parseDateOnly(value)

  if (!parsed) {
    return null
  }

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

export function getReadingCountdownLabel(readingDate: string | null | undefined) {
  const daysUntil = getDaysUntilReading(readingDate)
  const formattedDate = formatGregorianDate(readingDate)

  if (!formattedDate || daysUntil === null) {
    return null
  }

  if (daysUntil > 1) {
    return `${daysUntil} ימים נשארו עד הקריאה בתורה · ${formattedDate}`
  }

  if (daysUntil === 1) {
    return `יום אחד נשאר עד הקריאה בתורה · ${formattedDate}`
  }

  if (daysUntil === 0) {
    return `הקריאה בתורה היא היום · ${formattedDate}`
  }

  return `תאריך הקריאה עבר · ${formattedDate}`
}
