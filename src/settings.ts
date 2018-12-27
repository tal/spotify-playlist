const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function buildMyFn(prefix?: string) {
  return function archivePlaylistNameFor({
    added_at,
  }: {
    added_at: string
  }): string {
    const addedAt = new Date(added_at)
    const month = addedAt.getMonth()
    const year = addedAt.getFullYear()

    prefix = prefix ? `${prefix} ` : ''

    return `${prefix}${year} - ${MONTH_NAMES[month]}`
  }
}

export async function settings() {
  if (dev.isDev) {
    return {
      inbox: 'Inbox Test',
      current: 'Current Test',
      timeToArchive: 1 * 24 * 60 * 60 * 1000,
      archivePlaylistNameFor: buildMyFn('[Test]'),
    }
  } else {
    return {
      inbox: 'Inbox',
      current: 'Current',
      timeToArchive: 30 * 24 * 60 * 60 * 1000,
      archivePlaylistNameFor: buildMyFn(),
    }
  }
}
