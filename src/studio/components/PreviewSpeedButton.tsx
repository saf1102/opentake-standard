import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PREVIEW_SPEEDS, setPreviewSpeed, usePreviewSpeed } from '../preview-speed';
import './preview-speed.css';

/** 1× / 2× / 4×: a narrow menu, the numbers say it all (S先生 10-31). */
export function PreviewSpeedButton({ className = '' }: { className?: string }) {
  const speed = usePreviewSpeed();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={`preview-speed-button ${className}`} aria-label={`预览倍速：${speed}×`} title="预览倍速（不改片子）">{speed}×</button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="preview-speed-menu" align="center" sideOffset={6}>
      {PREVIEW_SPEEDS.map(value => <DropdownMenuItem key={value} aria-current={value === speed ? 'true' : undefined} onSelect={() => setPreviewSpeed(value)}>{value}×</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
