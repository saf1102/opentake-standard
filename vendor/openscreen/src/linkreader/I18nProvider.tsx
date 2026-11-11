import type { ReactNode } from "react";
import { I18nProvider } from "../contexts/I18nContext";

/** OpenTake's embedded editor has its own default; standalone OpenScreen keeps
 * the upstream default and system-language prompt. A saved manual choice wins. */
export function LinkReaderI18nProvider({ children }: { children: ReactNode }) {
	return <I18nProvider defaultLocale="zh-CN" suggestSystemLocale={false}>{children}</I18nProvider>;
}
