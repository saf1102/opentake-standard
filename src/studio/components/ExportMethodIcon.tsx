import {Files} from 'lucide-react';
import {EXPORT_METHOD_ICONS} from './export-icons';
import './export-method-icon.css';

/** One visual identity for the selector, current mode and export history. */
export function ExportMethodIcon({kind}:{kind:'video'|'jianying'|'files'}) {
  const Icon=kind==='video'?EXPORT_METHOD_ICONS.quick:kind==='jianying'?EXPORT_METHOD_ICONS.jianying:Files;
  return <span className={`export-method-icon export-method-icon--${kind}`} aria-hidden="true"><Icon /></span>;
}
