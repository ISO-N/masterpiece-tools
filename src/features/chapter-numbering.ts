import { App, TFile } from 'obsidian';

/** 匹配「第 12 章 / 第3节 / 第 8 讲」这类章节前缀 */
const CHAPTER_PATTERN = /^第\s*(\d+)\s*(章|节|讲|篇|课|单元)/;

export interface ChapterItem {
	/** 原路径 */
	path: string;
	/** 原文件名 */
	name: string;
	/** 目标文件名 */
	targetName: string;
	/** 目标路径 */
	targetPath: string;
	/** 章号 */
	chapter: number;
	/** 冲突原因，有值表示不会被改名 */
	conflict?: string;
}

export interface ChapterScanResult {
	/** 可安全改名的条目 */
	items: ChapterItem[];
	/** 存在冲突、会被跳过的条目 */
	conflicts: ChapterItem[];
	/** 扫描到的「第 N 章」类笔记数量 */
	matched: number;
	/** 扫描的笔记总数 */
	scanned: number;
	/** 补零位数 */
	padWidth: number;
}

/**
 * 扫描全库，找出章号没有补零的笔记，并算出改名方案。
 *
 * 补零位数根据库内最大章号自动决定（不足两位补到两位），
 * 这样 `第1章` 会排到 `第10章` 前面，而不是被字典序挤到后面。
 */
export function scanChapterNumbering(app: App): ChapterScanResult {
	const files = app.vault.getFiles().filter((file) => file.extension === 'md');

	interface Matched {
		file: TFile;
		chapter: number;
		unit: string;
		rest: string;
	}

	const matched: Matched[] = [];
	let maxChapter = 0;

	for (const file of files) {
		const match = CHAPTER_PATTERN.exec(file.basename);
		if (!match) continue;
		const chapter = Number(match[1]);
		if (!Number.isFinite(chapter)) continue;

		matched.push({
			file,
			chapter,
			unit: match[2] ?? '',
			rest: file.basename.slice(match[0].length),
		});
		if (chapter > maxChapter) maxChapter = chapter;
	}

	const padWidth = Math.max(2, String(maxChapter).length);
	const existingPaths = new Set(app.vault.getAllLoadedFiles().map((entry) => entry.path));

	const items: ChapterItem[] = [];
	for (const entry of matched) {
		const padded = String(entry.chapter).padStart(padWidth, '0');
		// 注意要用 name 保留扩展名，basename 已经把 .md 去掉了
		const targetName = `第${padded}${entry.unit}${entry.rest}.${entry.file.extension}`;
		// 已经规范过的不重复处理
		if (targetName === entry.file.name) continue;

		const dir = entry.file.path.split('/').slice(0, -1).join('/');
		items.push({
			path: entry.file.path,
			name: entry.file.name,
			targetName,
			targetPath: dir ? `${dir}/${targetName}` : targetName,
			chapter: entry.chapter,
		});
	}

	// 冲突一：多篇笔记改名后会撞到同一个名字
	const byTarget = new Map<string, ChapterItem[]>();
	for (const item of items) {
		const bucket = byTarget.get(item.targetPath);
		if (bucket) bucket.push(item);
		else byTarget.set(item.targetPath, [item]);
	}
	for (const bucket of byTarget.values()) {
		if (bucket.length > 1) {
			for (const item of bucket) {
				item.conflict = `与另外 ${bucket.length - 1} 篇笔记的目标名重复`;
			}
		}
	}

	// 冲突二：目标名已被别的文件占用
	for (const item of items) {
		if (item.conflict) continue;
		if (existingPaths.has(item.targetPath) && item.targetPath !== item.path) {
			item.conflict = '目标名称已被占用';
		}
	}

	return {
		items: items.filter((item) => !item.conflict),
		conflicts: items.filter((item) => item.conflict),
		matched: matched.length,
		scanned: files.length,
		padWidth,
	};
}

export interface ChapterApplyResult {
	renamed: number;
	failed: { path: string; reason: string }[];
}

/**
 * 执行改名。
 *
 * 走 FileManager.renameFile 而不是 Vault.rename，这样 Obsidian 会同步把
 * 全库里指向这些笔记的双链一起改掉，不会产生断链。
 */
export async function applyChapterNumbering(
	app: App,
	items: ChapterItem[],
): Promise<ChapterApplyResult> {
	const result: ChapterApplyResult = { renamed: 0, failed: [] };

	for (const item of items) {
		const file = app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) {
			result.failed.push({ path: item.path, reason: '文件已不存在' });
			continue;
		}
		try {
			await app.fileManager.renameFile(file, item.targetPath);
			result.renamed += 1;
		} catch (error) {
			result.failed.push({
				path: item.path,
				reason: (error as Error).message,
			});
		}
	}

	return result;
}
