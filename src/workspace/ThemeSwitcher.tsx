import {useEffect, useState} from 'react';
import {Contrast} from 'lucide-react';
import {DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {applyUiTheme, readUiTheme, type UiTheme} from './ui-theme';

const THEME_LABELS: Record<UiTheme, string> = {original: '原色', warm: '暖雾'};
const THEMES = ['original', 'warm'] as const;

/** Segmented switch in 系统设置; `compact` is the one-icon menu used in the top bar. */
export function ThemeSwitcher({compact = false}: {compact?: boolean}) {
  const [theme, setTheme] = useState(readUiTheme);
  useEffect(() => {
    const sync = () => { const next = readUiTheme(); document.documentElement.dataset.uiTheme = next; setTheme(next); };
    window.addEventListener('storage', sync);
    window.addEventListener('linkreader-ui-theme', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('linkreader-ui-theme', sync); };
  }, []);
  if (compact) return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className="ui-theme-menu-trigger" aria-label={`操作界面主题：${THEME_LABELS[theme]}`} title={`操作界面主题：${THEME_LABELS[theme]}`}><Contrast size={17} /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="ui-theme-menu">
      <DropdownMenuLabel>操作界面主题</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={value => applyUiTheme(value as UiTheme)}>
        {THEMES.map(value => <DropdownMenuRadioItem key={value} value={value}>{THEME_LABELS[value]}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
  return <div className="ui-theme-switch" role="group" aria-label="操作界面主题">
    {THEMES.map(value => <button key={value} type="button" aria-pressed={theme === value} onClick={() => applyUiTheme(value)}>{THEME_LABELS[value]}</button>)}
  </div>;
}
