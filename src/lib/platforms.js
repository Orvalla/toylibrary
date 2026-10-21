// The platform families the product tracks. Keys must match the CHECK
// constraints on items.platform / catalog_items.platform in the
// migrations (0001 as widened by 0006_yoto_platform.sql and
// 0007_new_platforms.sql).
export const PLATFORMS = [
  { key: 'tonies', label: 'Tonies / Toniebox', emoji: '🎧' },
  { key: 'yoto', label: 'Yoto', emoji: '🎵' },
  { key: 'storypod', label: 'Storypod', emoji: '🎙️' },
  { key: 'leapfrog', label: 'LeapPad / LeapFrog', emoji: '🐸' },
  { key: 'lunii', label: 'Lunii', emoji: '🌙' },
  { key: 'projector', label: 'Storybook projector', emoji: '🔦' },
  { key: 'osmo', label: 'Osmo', emoji: '🧩' },
  { key: 'vtech', label: 'VTech', emoji: '🧸' },
  { key: 'books', label: 'Books', emoji: '📚' },
  { key: 'other', label: 'Other', emoji: '🎁' },
]

export const platformLabel = (key) =>
  PLATFORMS.find((p) => p.key === key)?.label ?? key

export const platformEmoji = (key) =>
  PLATFORMS.find((p) => p.key === key)?.emoji ?? '🎁'
