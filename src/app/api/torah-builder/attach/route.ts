import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      message: 'Torah Builder הוסר מהמערכת ואינו זמין יותר.',
    },
    { status: 410 }
  )
}
