import type { IncomingMessage } from "node:http";
import { bodyJson, sendJson } from "../../http.ts";
import { readLock } from "../store.ts";
import {
  archiveOpenScreenDocument,
  createOpenScreenDocument,
  duplicateOpenScreenDocument,
  listOpenScreenDocuments,
  readOpenScreenDocument,
  saveOpenScreenDocument,
} from "../openscreen-documents.ts";
import {
  cancelOpenScreenHostSession,
  importOpenScreenHostCandidate,
  launchOpenScreenHud,
  listOpenScreenHostSessions,
  readOpenScreenHostSession,
} from "../openscreen-host.ts";
import {
  compactOpenScreenCodexSession,
  createOpenScreenCodexSession,
  deleteOpenScreenCodexSession,
  getOpenScreenCodexSession,
  listOpenScreenCodexSessions,
  openScreenCodexBudget,
  renameOpenScreenCodexSession,
  rewindOpenScreenCodexSession,
  runOpenScreenCodexTurn,
  translateOpenScreenCaptions,
} from "../openscreen-codex.ts";
import {
  cancelOpenScreenExport,
  createOpenScreenExportTarget,
  readOpenScreenExport,
  revealOpenScreenExport,
  startOpenScreenExport,
} from "../openscreen-export.ts";
const handled = (_value:unknown) => true;
import type { ServerResponse } from "node:http";
type ProjectRouteContext={req:IncomingMessage;res:ServerResponse;parts:string[];id:string;dir:string};

/** OpenScreen 域：录屏文档、文档导出、宿主录制会话、codex 会话、字幕翻译与 STT。 */
export async function handleOpenScreenApi(ctx: ProjectRouteContext): Promise<boolean> {
  const { req, res, parts, id, dir } = ctx;
  if (parts[2] === "openscreen" && parts[3] === "documents" && parts.length === 4) {
    if (req.method === "GET")
      return handled(sendJson(res, 200, { ok: true, result: listOpenScreenDocuments(id) }));
    if (req.method === "POST") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 201, {
        ok: true,
        result: createOpenScreenDocument(id, {
          document: body.document,
          documentId: body.documentId,
        }),
      }));
    }
  }
  if (parts[2] === "openscreen" && parts[3] === "documents" && parts[4]) {
    const documentId = parts[4];
    if (parts[5] === "export-target" && req.method === "POST") {
      return handled(sendJson(res, 200, {
        ok: true,
        result: createOpenScreenExportTarget(id, documentId, await bodyJson(req)),
      }));
    }
    if (parts[5] === "exports" && parts.length === 6 && req.method === "POST") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 201, {
        ok: true,
        result: startOpenScreenExport(id, documentId, body),
      }));
    }
    if (parts[5] === "exports" && parts[6] && parts.length === 7 && req.method === "GET") {
      return handled(sendJson(res, 200, {
        ok: true,
        result: readOpenScreenExport(id, documentId, parts[6]),
      }));
    }
    if (parts[5] === "exports" && parts[6] && parts[7] === "cancel" && req.method === "POST") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 200, {
        ok: true,
        result: cancelOpenScreenExport(id, documentId, parts[6]),
      }));
    }
    if (parts[5] === "reveal" && req.method === "POST") {
      const body = await bodyJson(req);
      return handled(sendJson(res, 200, {
        ok: true,
        result: revealOpenScreenExport(id, body.path),
      }));
    }
    if (parts[5] === "captions" && parts[6] === "translate" && req.method === "POST") {
      return handled(sendJson(res, 200, {
        ok: true,
        result: await translateOpenScreenCaptions({
          linkReaderProjectId: id,
          documentId,
          value: await bodyJson(req),
        }),
      }));
    }
    if (parts[5] === "chat" && parts[6] === "sessions") {
      if (parts.length === 7 && req.method === "GET")
        return handled(sendJson(res, 200, {
          ok: true,
          result: listOpenScreenCodexSessions(id, documentId),
        }));
      if (parts.length === 7 && req.method === "POST") {
        const body = await bodyJson(req);
        return handled(sendJson(res, 201, {
          ok: true,
          result: createOpenScreenCodexSession(
            id,
            documentId,
            typeof body.title === "string" ? body.title : undefined,
          ),
        }));
      }
      const sessionId = parts[7];
      if (sessionId && parts.length === 8 && req.method === "GET")
        return handled(sendJson(res, 200, {
          ok: true,
          result: getOpenScreenCodexSession(id, documentId, sessionId),
        }));
      if (sessionId && parts.length === 8 && req.method === "PATCH") {
        const body = await bodyJson(req);
        return handled(sendJson(res, 200, {
          ok: true,
          result: renameOpenScreenCodexSession(
            id,
            documentId,
            sessionId,
            String(body.title || ""),
          ),
        }));
      }
      if (sessionId && parts.length === 8 && req.method === "DELETE")
        return handled(sendJson(res, 200, {
          ok: true,
          result: deleteOpenScreenCodexSession(id, documentId, sessionId),
        }));
      if (sessionId && parts[8] === "run" && req.method === "POST") {
        const body = await bodyJson(req);
        const lock = readLock(dir);
        if (lock && lock.clientId !== String(body.clientId || ""))
          return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
        return handled(sendJson(res, 200, {
          ok: true,
          result: await runOpenScreenCodexTurn({
            linkReaderProjectId: id,
            documentId,
            sessionId,
            message: String(body.message || ""),
            document: body.document,
          }),
        }));
      }
      if (sessionId && parts[8] === "rewind" && req.method === "POST") {
        const body = await bodyJson(req);
        const lock = readLock(dir);
        if (lock && lock.clientId !== String(body.clientId || ""))
          return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
        return handled(sendJson(res, 200, {
          ok: true,
          result: rewindOpenScreenCodexSession(id, documentId, sessionId, String(body.messageId || "")),
        }));
      }
      if (sessionId && parts[8] === "budget" && req.method === "GET")
        return handled(sendJson(res, 200, {
          ok: true,
          result: openScreenCodexBudget(id, documentId, sessionId),
        }));
      if (sessionId && parts[8] === "compact" && req.method === "POST")
        return handled(sendJson(res, 200, {
          ok: true,
          result: compactOpenScreenCodexSession(id, documentId, sessionId),
        }));
    }
    if (parts.length === 5 && req.method === "GET")
      return handled(sendJson(res, 200, { ok: true, result: readOpenScreenDocument(id, documentId) }));
    if (parts.length === 5 && req.method === "PUT") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 200, {
        ok: true,
        result: saveOpenScreenDocument(id, documentId, {
          document: body.document,
          revision: body.revision,
        }),
      }));
    }
    if (parts.length === 5 && req.method === "DELETE") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 200, { ok: true, result: archiveOpenScreenDocument(id, documentId) }));
    }
    if (parts[5] === "duplicate" && req.method === "POST")
    {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 201, { ok: true, result: duplicateOpenScreenDocument(id, documentId) }));
    }
  }
  if (parts[2] === "openscreen" && parts[3] === "host-sessions" && parts.length === 4) {
    if (req.method === "GET")
      return handled(sendJson(res, 200, { ok: true, result: listOpenScreenHostSessions(id) }));
    if (req.method === "POST") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 201, { ok: true, result: launchOpenScreenHud(id) }));
    }
  }
  if (parts[2] === "openscreen" && parts[3] === "host-sessions" && parts[4]) {
    if (parts.length === 5 && req.method === "GET")
      return handled(sendJson(res, 200, { ok: true, result: readOpenScreenHostSession(id, parts[4]) }));
    if (parts[5] === "cancel" && req.method === "POST") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 200, {
        ok: true,
        result: cancelOpenScreenHostSession(id, parts[4]),
      }));
    }
    if (parts[5] === "confirm" && req.method === "POST") {
      const body = await bodyJson(req);
      const lock = readLock(dir);
      if (lock && lock.clientId !== String(body.clientId || ""))
        return handled(sendJson(res, 423, { ok: false, error: "工程正由其他设备编辑", lock }));
      return handled(sendJson(res, 200, {
        ok: true,
        result: await importOpenScreenHostCandidate(id, parts[4], body.file),
      }));
    }
  }
  return false;
}
