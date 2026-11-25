// The panel's page: Orca wraps this module in a generated document. Preact draws the views.
import { html, render } from '../vendor/preact.mjs'
import { App } from './app'
import { STYLES } from './style'

const style = document.createElement('style')
style.textContent = STYLES
document.head.append(style)

const root = document.createElement('div')
document.body.append(root)
render(html`<${App} />`, root)
