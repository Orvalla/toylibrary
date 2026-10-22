// The platform families the product tracks. Keys must match the CHECK
// constraints on items.platform / catalog_items.platform in the
// migrations (0001 as widened by 0006_yoto_platform.sql and
// 0007_new_platforms.sql).
export const PLATFORMS = [
  { key: 'tonies', label: 'Tonies / Toniebox', emoji: '🎧', logo: '/logos/tonies.svg' },
  { key: 'yoto', label: 'Yoto', emoji: '🎵', logo: '/logos/yoto.png', logoBg: '#F0442E' },
  { key: 'storypod', label: 'Storypod', emoji: '🎙️', logo: '/logos/storypod.png' },
  { key: 'leapfrog', label: 'LeapPad / LeapFrog', emoji: '🐸', logo: '/logos/leapfrog.svg' },
  { key: 'lunii', label: 'Lunii', emoji: '🌙', logo: '/logos/lunii.svg' },
  { key: 'projector', label: 'Storybook projector', emoji: '🔦' },
  { key: 'osmo', label: 'Osmo', emoji: '🧩', logo: '/logos/osmo.png', logoBg: '#6C4BD8' },
  { key: 'vtech', label: 'VTech', emoji: '🧸', logo: '/logos/vtech.svg' },
  { key: 'books', label: 'Books', emoji: '📚' },
  { key: 'other', label: 'Other', emoji: '🎁' },
]

export const platformLabel = (key) =>
  PLATFORMS.find((p) => p.key === key)?.label ?? key

export const platformEmoji = (key) =>
  PLATFORMS.find((p) => p.key === key)?.emoji ?? '🎁'
