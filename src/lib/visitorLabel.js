// A stable, friendly nickname for an anonymous analytics
// visitor, derived only from the random visitor id their
// browser already stores (migration 0040). The same browser
// always hashes to the same nickname, so the admin panel can
// tell repeat guests apart — no IP address, no fingerprint,
// nothing new collected. The trailing code keeps nicknames
// that collide on name visibly distinct.

const COLORS = [
  'Teal', 'Coral', 'Amber', 'Violet', 'Indigo', 'Crimson',
  'Jade', 'Slate', 'Rust', 'Olive', 'Plum', 'Ochre',
  'Cobalt', 'Mauve', 'Pearl', 'Clay',
]

const ANIMALS = [
  'Fox', 'Otter', 'Heron', 'Mole', 'Finch', 'Badger',
  'Lynx', 'Crane', 'Newt', 'Vole', 'Ibis', 'Marten',
  'Quail', 'Stoat', 'Egret', 'Pika',
]

export function visitorLabel(visitorId) {
  if (!visitorId) return 'Unknown guest'
  const text = String(visitorId)
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  const color = COLORS[h % COLORS.length]
  const animal = ANIMALS[Math.floor(h / COLORS.length) % ANIMALS.length]
  const code = (h % 65536).toString(16).toUpperCase().padStart(4, '0')
  return `${color} ${animal} · ${code}`
}
