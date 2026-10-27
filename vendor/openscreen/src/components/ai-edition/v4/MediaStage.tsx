import { CheckCircle2, Film, FolderOpen, RefreshCw, Search, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AxcutAsset } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { formatSeconds } from "@/lib/ai-edition/timeline/format";
import { nativeBridgeClient } from "@/native";
import type { AiEditionProjectSummary } from "@/native/contracts";
import styles from "./EditorShellV4.module.css";

const THUMBS = [
	"linear-gradient(135deg, #fb7185, #f97316)",
	"linear-gradient(135deg, #10b981, #0d986a)",
	"linear-gradient(135deg, #38bdf8, #6366f1)",
	"linear-gradient(135deg, #fbbf24, #f59e0b)",
];

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

// Kept for the existing unit contract. The Media page itself now lists
// recording subprojects rather than the active document's asset array.
export async function addSelectedAssetToTimeline(
	selected: Pick<AxcutAsset, "id" | "label" | "originalPath"> | null,
	onAddToTimeline: (assetId: string) => Promise<void>,
	onSuccess: (label: string) => void,
): Promise<void> {
	if (!selected) return;
	await onAddToTimeline(selected.id);
	onSuccess(selected.label || basename(selected.originalPath));
}

const buttonStyle = {
	width: "100%",
	height: 40,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	gap: 7,
	borderRadius: 9,
	cursor: "pointer",
} as const;

export function MediaStage({
	onOpenProject,
}: {
	onOpenProject: (documentId: string) => Promise<void>;
}) {
	const activeProjectId = useProjectStore((state) => state.projectId);
	const [projects, setProjects] = useState<AiEditionProjectSummary[]>([]);
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [opening, setOpening] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const next = await nativeBridgeClient.aiEdition.listProjects();
			setProjects(next);
			setSelectedId((current) =>
				current && next.some((project) => project.id === current)
					? current
					: activeProjectId || next[0]?.id || null,
			);
		} catch (error) {
			toast.error("无法读取录屏子工程", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setLoading(false);
		}
	}, [activeProjectId]);

	useEffect(() => void refresh(), [refresh]);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		if (!normalized) return projects;
		return projects.filter((project) =>
			[project.title, ...(project.sourceAssetNames || [])]
				.join(" ")
				.toLocaleLowerCase()
				.includes(normalized),
		);
	}, [projects, query]);
	const selected = projects.find((project) => project.id === selectedId) || null;

	const openSelected = async () => {
		if (!selected || opening) return;
		setOpening(true);
		try {
			await onOpenProject(selected.id);
			toast.success(`已打开录屏子工程「${selected.title}」`);
		} finally {
			setOpening(false);
		}
	};


	return (
		<div className={styles.mediaStage}>
			<div className={styles.mediaInner} style={{ maxWidth: selected ? 1120 : 900 }}>
				<div className={styles.mediaSearchRow}>
					<Search size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="搜索当前工程的录屏子工程…"
					/>
					<button
						type="button"
						title="重新载入"
						onClick={() => void refresh()}
						style={{ border: 0, background: "transparent", color: "var(--muted)" }}
					>
						<RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
					</button>
				</div>
				<div className={styles.mediaCols}>
					<div className={styles.mediaListCol}>
						<div
							className={styles.mediaGrid}
							style={{ gridTemplateColumns: selected ? "repeat(2,1fr)" : "repeat(3,1fr)" }}
						>
							{filtered.map((project, index) => (
								<button
									type="button"
									key={project.id}
									className={`${styles.mediaCard}${project.id === selectedId ? ` ${styles.selected}` : ""}`}
									onClick={() => setSelectedId(project.id)}
								>
									<div className={styles.mediaThumb} style={{ background: THUMBS[index % THUMBS.length] }}>
										<Film size={30} strokeWidth={1.8} />
									</div>
									<div className={styles.mediaCardMeta}>
										{project.id === activeProjectId ? (
											<span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
										) : null}
										<div className={styles.body}>
											<div className={styles.mediaCardName}>{project.title}</div>
											<div className={styles.mediaCardStats}>
												<span className={styles.dur}>{formatSeconds(project.durationSec || 0)}</span>
												<span className={styles.size}>{project.assetCount} 个源素材</span>
											</div>
										</div>
										{project.latestPublishedAssetId ? <CheckCircle2 size={15} color="var(--success)" /> : null}
									</div>
								</button>
							))}
						</div>
						<div className={styles.mediaHint}>
							{loading
								? "正在读取录屏子工程…"
								: projects.length
									? "这里显示当前 LinkReader 工程内的录屏子工程"
									: "开始一次录屏后，子工程会自动出现在这里"}
						</div>
					</div>

					{selected ? (
						<div className={styles.mediaDetail}>
							<div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
								<div>
									<h2 style={{ margin: 0, fontSize: 16.5, color: "var(--fg-emphasis)" }}>录屏子工程</h2>
									<p style={{ margin: "6px 0 16px", fontSize: 12, color: "var(--muted)" }}>{selected.title}</p>
								</div>
								<button type="button" aria-label="关闭详情" onClick={() => setSelectedId(null)} style={{ border: 0, background: "transparent", color: "var(--muted)" }}>
									<X size={15} />
								</button>
							</div>
							<div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", fontSize: 12, lineHeight: 1.8, color: "var(--fg-2)" }}>
								<div>原始录屏：{selected.sourceAssetNames?.join("、") || `${selected.assetCount} 个源素材`}</div>
								<div>子工程时长：{formatSeconds(selected.durationSec || 0)}</div>
								<div>编辑版本：r{selected.revision || 0}</div>
								<div>最新成片：{selected.latestPublishedAssetName || "尚未发送到剪辑台"}</div>
							</div>
							<button
								type="button"
								onClick={() => void openSelected()}
								disabled={opening}
								style={{ ...buttonStyle, marginTop: 14, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--fg)" }}
							>
								<FolderOpen size={14} />
								{opening ? "正在打开…" : selected.id === activeProjectId ? "继续编辑" : "打开这段录屏"}
							</button>
							
							<p style={{ margin: "12px 2px 0", fontSize: 11.5, lineHeight: 1.6, color: "var(--muted)" }}>
								发送会生成一个新的运镜成片，保留原始录屏和本子工程的编辑状态。
							</p>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
