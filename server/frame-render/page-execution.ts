import {redact} from '../../shared/redaction.mjs';

export type PageExecutionDiagnostic = {
  kind: 'generated-page'; operation: 'load' | 'select' | 'seek'; file: string;
  line?: number; column?: number; frame?: number; message: string; stack: string;
};

/** A page-code failure is repairable by its author; tool/OS failures are not classified here. */
export class PageExecutionError extends Error {
  readonly diagnostic: PageExecutionDiagnostic;
  diagnosticFile?: string;
  constructor(operation: PageExecutionDiagnostic['operation'], error: unknown, frame?: number) {
    const raw = error instanceof Error ? error : new Error(String(error));
    const stack = redact(raw.stack || raw.message).slice(0, 12000);
    const location = stack.match(/https?:\/\/(?:ot-render|hf)\.localhost(?::\d+)?\/([^\s?#)]+?):(\d+):(\d+)/);
    const file = location?.[1] || 'index.html';
    const message = redact(raw.message).replace(/^page\.evaluate:\s*/, '').split('\n')[0].slice(0, 1000);
    // Runtime injection changes HTML line numbers. Keep that location for the
    // stack trace, without presenting it as an original-source line number.
    super(`生成页面执行失败（${file}${frame === undefined ? '' : '，第 ' + frame + ' 帧'}）：${message}`, {cause: raw});
    this.name = 'PageExecutionError';
    this.diagnostic = {kind: 'generated-page', operation, file, message, stack,
      ...(location ? {line: Number(location[2]), column: Number(location[3])} : {}),
      ...(frame === undefined ? {} : {frame})};
  }
}
