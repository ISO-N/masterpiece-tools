import { App, TFile, moment } from 'obsidian';
import type { MasterpieceSettings } from '../settings';
import {
	buildVaultTree,
	countNodes,
	resolveMocBasename,
	resolveReadmePath,
	toMocLink,
	toWikiLink,
	type TreeStats,
	type VaultNode,
} from './vault-tree';

export interface ReadmeResult {
	/** 实际写入的路径 */
	path: string;
	/** 是否是新建的文件 */
	created: boolean;
	/** 文件夹数量 */
	folderCount: number;
	/** 文件数量 */
	fileCount: number;
	/** 生成的内容 */
	content: string;
}

function renderNodes(
	app: App,
	nodes: VaultNode[],
	settings: MasterpieceSettings,
	sourcePath: string,
	mocBasename: string,
	depth: number,
	lines: string[],
): void {
	const indent = '\t'.repeat(depth);
	for (const node of nodes) {
		if (node.isFolder) {
			const prefix = settings.folderEmoji ? '📁 ' : '';
			// 文件夹链向自己的 MOC，索引从「内容列表」变成「导航入口」
			lines.push(
				`${indent}- ${prefix}${toMocLink(node.path, node.name, mocBasename)}`,
			);
			renderNodes(
				app,
				node.children,
				settings,
				sourcePath,
				mocBasename,
				depth + 1,
				lines,
			);
		} else if (node.file) {
			lines.push(`${indent}- ${toWikiLink(app, node.file, sourcePath)}`);
		}
	}
}

/**
 * 生成 README 全文
 */
export function buildReadmeContent(
	app: App,
	settings: MasterpieceSettings,
): { content: string; folderCount: number; fileCount: number } {
	const path = resolveReadmePath(settings);
	const mocBasename = resolveMocBasename(settings);
	const nodes = buildVaultTree(app, settings, settings.includeAttachments);

	const stats: TreeStats = { folderCount: 0, fileCount: 0 };
	countNodes(nodes, stats);

	const now = moment().format('YYYY-MM-DD HH:mm:ss');
	const lines: string[] = [
		`# ${settings.readmeTitle}`,
		'',
		'> [!info] 本文件由 Masterpiece Workbench 自动生成，请勿手动编辑',
		`> 最后更新：${now} · ${stats.folderCount} 个文件夹 / ${stats.fileCount} 个文件`,
		'',
	];

	if (nodes.length === 0) {
		lines.push('_仓库里还没有可索引的文件。_');
	} else {
		renderNodes(app, nodes, settings, path, mocBasename, 0, lines);
	}

	lines.push('');
	return { content: lines.join('\n'), ...stats };
}

/** 确保目标路径的父文件夹存在 */
async function ensureParentFolder(app: App, path: string): Promise<void> {
	const parent = path.split('/').slice(0, -1).join('/');
	if (!parent) return;
	const existing = app.vault.getAbstractFileByPath(parent);
	if (existing) return;
	try {
		await app.vault.createFolder(parent);
	} catch {
		// 并发创建时可能已被别的流程建好，忽略
	}
}

/**
 * 重建仓库根目录的 README 索引
 */
export async function updateVaultReadme(
	app: App,
	settings: MasterpieceSettings,
): Promise<ReadmeResult> {
	const path = resolveReadmePath(settings);
	const { content, folderCount, fileCount } = buildReadmeContent(app, settings);
	const existing = app.vault.getAbstractFileByPath(path);

	let created = false;
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await ensureParentFolder(app, path);
		await app.vault.create(path, content);
		created = true;
	}

	if (settings.openAfterUpdate) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			// 固定开在主编辑区的新标签页，避免挤掉侧边栏的工作台
			await app.workspace.getLeaf('tab').openFile(file);
		}
	}

	return { path, created, folderCount, fileCount, content };
}
