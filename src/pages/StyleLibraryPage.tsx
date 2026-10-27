import { StyleLibrary } from '@/workspace/style-library/StyleLibrary'
import { MODULE_ONLY_LABELS } from '@/workspace/modules'

/** /styles: 风格库 as a module, in browse mode. */
export default function StyleLibraryPage() {
  return <main className="styles-page" aria-labelledby="styles-page-title">
    <div className="styles-page__shield" aria-hidden="true" />
    <StyleLibrary mode="browse" title={<div className="styles-page__title">
      <h1 id="styles-page-title">风格库</h1>
      <span className="styles-page__only"><i className="sl-dot" aria-hidden="true" />{MODULE_ONLY_LABELS.general}</span>
    </div>} />
  </main>
}
