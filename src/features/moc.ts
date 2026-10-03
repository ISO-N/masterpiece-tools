import { App, TFile, normalizePath } from 'obsidian';
import type { MasterpieceSettings } from '../settings';
import { MOC_MANUAL_HINT, MOC_MARKER } from '../constants';
import {
	buildVaultTree,
	collectFolders,
	resolveMocBasename,
	toMocLink,
	toWikiLink,
	type VaultNode,
} from './vault-tree';

export interface MocResult {
	/** 新建的 MOC 数量 */
	created: number;
	/** 内容有变化的 MOC 数量 */
	updated: number;
	/** 内容无变化、跳过的 MOC 数量 */
	unchanged: number;
	/** 因为没有标记而被跳过的文件（不是插件生成的，绝不碰） */
	skipped: string[];
	/** 标记损坏、拒绝写入的文件 */
	failed: { path: string; reason: string }[];
}

/** 首次生成时的文件骨架 */
function buildTemplate(head: string, body: string): string {
	return [
		MOC_MARKER.headStart,
		head,
		MOC_MARKER.headEnd,
		'',
		MOC_MARKER.manualStart,
		MOC_MANUAL_HINT,
		MOC_MARKER.manualEnd,
		'',
		MOC_MARKER.bodyStart,
		body,
		MOC_MARKER.bodyEnd,
		'',
	].join('\n');
}

type ReplaceOutcome =
	| { ok: true; value: string }
	| { ok: false; reason: string };

/**
 * 只替换标记之间的内容，标记之外（含用户手写的段落）原样保留。
 */
function replaceBlock(
	content: string,
	start: string,
	end: string,
	inner: string,
): ReplaceOutcome {
	const startIndex = content.indexOf(start);
	const endIndex = content.indexOf(end);

	if (startIndex === -1 || endIndex === -1) {
		return { ok: false, reason: `缺少 ${start} 或 ${end} 标记` };
	}
	if (endIndex < startIndex) {
		return { ok: false, reason: '标记顺序颠倒，无法安全定位' };
	}

	const before = content.slice(0, startIndex + start.length);
	const after = content.slice(endIndex);
	return { ok: true, value: `${before}\n${inner}\n${after}` };
}

/** 自动区 body：子目录 MOC + 本级笔记 */
function renderBody(
	app: App,
	folder: VaultNode,
	mocPath: string,
	mocBasename: string,
): string {
	const subfolders = folder.children.filter((child) => child.isFolder);
	const notes = folder.children.filter((child) => !child.isFolder && child.file);
	const lines: string[] = [];

	if (subfolders.length > 0) {
		lines.push('## 子目录', '');
		for (const sub of subfolders) {
			lines.push(`- ${toMocLink(sub.path, sub.name, mocBasename)}`);
		}
		lines.push('');
	}

	if (notes.length > 0) {
		lines.push('## 笔记', '');
		for (const note of notes) {
			if (note.file) lines.push(`- ${toWikiLink(app, note.file, mocPath)}`);
		}
		lines.push('');
	}

	if (lines.length === 0) lines.push('_这个文件夹还是空的。_', '');
	return lines.join('\n').trimEnd();
}

/**
 * 为仓库内每个文件夹生成 / 更新一份 MOC 索引笔记。
 *
 * 安全原则：**标记即所有权**。
 * - 文件里的两个自动区标记齐全 → 只重写自动区
 * - 完全没有标记 → 不是插件生成的文件，跳过不碰
 * - 标记只出现一半 → 拒绝写入并上报，绝不猜测意图
 */
export async function generateFolderMocs(
	app: App,
	settings: MasterpieceSettings,
): Promise<MocResult> {
	const mocBasename = resolveMocBasename(settings);
	// MOC 只索引笔记，不索引附件
	const folders = collectFolders(buildVaultTree(app, settings, false));

	const result: MocResult = {
		created: 0,
		updated: 0,
		unchanged: 0,
		skipped: [],
		failed: [],
	};

	for (const folder of folders) {
		const mocPath = normalizePath(`${folder.path}/${mocBasename}.md`);
		const head = `# ${folder.name}`;
		const body = renderBody(app, folder, mocPath, mocBasename);
		const existing = app.vault.getAbstractFileByPath(mocPath);

		if (!(existing instanceof TFile)) {
			try {
				await app.vault.create(mocPath, buildTemplate(head, body));
				result.created += 1;
			} catch (error) {
				result.failed.push({
					path: mocPath,
					reason: `创建失败：${(error as Error).message}`,
				});
			}
			continue;
		}

		let content: string;
		try {
			content = await app.vault.read(existing);
		} catch (error) {
			result.failed.push({
				path: mocPath,
				reason: `读取失败：${(error as Error).message}`,
			});
			continue;
		}

		const hasHead =
			content.includes(MOC_MARKER.headStart) &&
			content.includes(MOC_MARKER.headEnd);
		const hasBody =
			content.includes(MOC_MARKER.bodyStart) &&
			content.includes(MOC_MARKER.bodyEnd);

		if (!hasHead && !hasBody) {
			// 用户自己写的同名笔记，原样保留
			result.skipped.push(mocPath);
			continue;
		}
		if (!hasHead || !hasBody) {
			result.failed.push({
				path: mocPath,
				reason: '自动区标记不完整，已跳过以免覆盖你的内容',
			});
			continue;
		}

		const headOutcome = replaceBlock(
			content,
			MOC_MARKER.headStart,
			MOC_MARKER.headEnd,
			head,
		);
		if (!headOutcome.ok) {
			result.failed.push({ path: mocPath, reason: headOutcome.reason });
			continue;
		}

		const bodyOutcome = replaceBlock(
			headOutcome.value,
			MOC_MARKER.bodyStart,
			MOC_MARKER.bodyEnd,
			body,
		);
		if (!bodyOutcome.ok) {
			result.failed.push({ path: mocPath, reason: bodyOutcome.reason });
			continue;
		}

		if (bodyOutcome.value === content) {
			result.unchanged += 1;
			continue;
		}

		try {
			await app.vault.modify(existing, bodyOutcome.value);
			result.updated += 1;
		} catch (error) {
			result.failed.push({
				path: mocPath,
				reason: `写入失败：${(error as Error).message}`,
			});
		}
	}

	return result;
}
