import { h } from '../vendor/preact.mjs'
import { ICONS, type IconName } from './icons-data'

export type { IconName }

/** A Lucide icon at Orca's sizes: 16 px in rows and buttons, 14 px inline in text. */
export function Icon({ name, size = 16, class: className }: { name: IconName; size?: number; class?: string }) {
  return h(
    'svg',
    {
      class: `icon${className ? ` ${className}` : ''}`,
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    },
    ICONS[name].map(([tag, attributes]) => h(tag, attributes))
  )
}
