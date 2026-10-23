import { ETHOS } from '../lib/ethos'

// The ethos as a simple icon-led list. Used by the landing
// page band and the welcome wizard's opening screen.
export default function Ethos() {
  return (
    <ul className="ethos-list">
      {ETHOS.map((e) => (
        <li key={e.title} className="ethos-row">
          <span className="ethos-icon" aria-hidden="true">
            {e.icon}
          </span>
          <span className="ethos-text">
            <strong>{e.title}.</strong> {e.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
