import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Hover card for a toolbar command: name, optional shortcut, and one line on what it actually does.
 *  The trigger is a wrapper span so the hint still explains a command while it is disabled. */
export function ToolbarHint({ title, detail, shortcut, children }: {
  title: string;
  detail?: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={260}>
      <TooltipTrigger asChild>
        <span className="toolbar-hint-anchor">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="toolbar-hint">
        <span className="toolbar-hint__head"><b>{title}</b>{shortcut ? <kbd>{shortcut}</kbd> : null}</span>
        {detail ? <span className="toolbar-hint__detail">{detail}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
