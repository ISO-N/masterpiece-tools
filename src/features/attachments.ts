import { App, TFile } from 'obsidian';
import type { MasterpieceSettings } from '../settings';
import { collectExclusions, isExcluded } from './vault-tree';

export interface OrphanAttachment {
	path: string;
	name: string;
	/** 所在文件夹，根目录为空字符串 */
	folder: string;
	extension: string;
	size: number | null;
}

export interface AttachmentScanResult {
	/** 纳入统计的附件总数 */
	total: number;
	/** 没有任何笔记引用的附件，按体积从大到小 */
	orphans: OrphanAttachment[];
	/** 未被引用附件的合计字节数 */
	orphanBytes: number;
	/** 按排除规则跳过的文件数 */
	skipped: number;
}

/** canvas 是可被引用的笔记类型，不算附件 */
const NOTE_EXTENSIONS = new Set(['md', 'canvas']);

export function isAttachment(file: TFile): boolean {
	return !NOTE_EXTENSIONS.has(file.extension);
}

/**
 * 收集所有「被别的文件指向过」的路径。
 *
 * 走两条路互为兜底：
 * 1. resolvedLinks 的键就是解析后的目标路径，链接和嵌入都在里面
 * 2. 再按每个源文件的 links / embeds 逐个解析一遍，防止个别嵌入没进图谱
 */
function collectReferencedPaths(app: App): Set<string> {
	const referenced = new Set<string>();
	const cache = app.metadataCache;

	for (const targets of Object.values(cache.resolvedLinks)) {
		for (const target of Object.keys(targets)) referenced.add(target);
	}

	for (const file of app.vault.getFiles()) {
		const fileCache = cache.getFileCache(file);
		if (!fileCache) continue;

		const refs = [...(fileCache.links ?? []), ...(fileCache.embeds ?? [])];
		for (const ref of refs) {
			const dest = cache.getFirstLinkpathDest(ref.link, file.path);
			if (dest) referenced.add(dest.path);
		}
	}

	return referenced;
}

async function readSize(app: App, path: string): Promise<number | null> {
	try {
		const stat = await app.vault.adapter.stat(path);
		return typeof stat?.size === 'number' ? stat.size : null;
	} catch {
		return null;
	}
}

/**
 * 扫描仓库，找出没有任何文件引用的附件。
 *
 * 只读：不移动、不删除、不改名，也不写任何文件。
 */
export async function scanOrphanAttachments(
	app: App,
	settings: MasterpieceSettings,
): Promise<AttachmentScanResult> {
	const patterns = collectExclusions(app, settings);
	const referenced = collectReferencedPaths(app);

	let skipped = 0;
	let total = 0;
	const candidates: TFile[] = [];

	for (const file of app.vault.getFiles()) {
		if (!isAttachment(file)) continue;
		if (isExcluded(file.path, patterns)) {
			skipped += 1;
			continue;
		}
		total += 1;
		if (!referenced.has(file.path)) candidates.push(file);
	}

	const orphans: OrphanAttachment[] = await Promise.all(
		candidates.map(async (file) => ({
			path: file.path,
			name: file.name,
			folder: file.path.split('/').slice(0, -1).join('/'),
			extension: file.extension,
			size: await readSize(app, file.path),
		})),
	);

	// 体积大的排前面，大小的收益最直观
	orphans.sort((a, b) => {
		const bySize = (b.size ?? 0) - (a.size ?? 0);
		if (bySize !== 0) return bySize;
		return a.name.localeCompare(b.name, 'zh-Hans-CN');
	});

	const orphanBytes = orphans.reduce((sum, item) => sum + (item.size ?? 0), 0);

	return { total, orphans, orphanBytes, skipped };
}
