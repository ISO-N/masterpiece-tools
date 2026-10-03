import { App, TFolder, TFile, normalizePath } from 'obsidian';
import type { MasterpieceSettings } from '../settings';

/** 仓库文件树的节点 */
export interface VaultNode {
	name: string;
	path: string;
	isFolder: boolean;
	children: VaultNode[];
	file?: TFile;
}

export interface TreeStats {
	folderCount: number;
	fileCount: number;
}

const SORT_LOCALE = 'zh-Hans-CN';

/** 把设置里的排除规则拆成数组 */
export function parsePatterns(raw: string): string[] {
	return raw
		.split('\n')
		.map((line) => normalizePath(line.trim().replace(/^\/+|\/+$/g, '')))
		.filter((line) => line.length > 0);
}

/** 判断某个路径是否应当被跳过 */
export function isExcluded(path: string, patterns: string[]): boolean {
	const segments = path.split('/');
	// 隐藏目录（.obsidian / .trash / .git 等）一律跳过
	if (segments.some((segment) => segment.startsWith('.'))) return true;
	return patterns.some(
		(pattern) => path === pattern || path.startsWith(`${pattern}/`),
	);
}

/** 排除规则 = 用户配置 + Obsidian 配置目录 */
export function collectExclusions(app: App, settings: MasterpieceSettings): string[] {
	const patterns = parsePatterns(settings.excludePatterns);
	patterns.push(normalizePath(app.vault.configDir));
	return patterns;
}

/** 取 MOC 文件名（不含扩展名），空值时回落到默认值 */
export function resolveMocBasename(settings: MasterpieceSettings): string {
	return settings.mocFilename.trim() || '_MOC';
}

/** 补全 .md 后缀并规范路径 */
export function resolveReadmePath(settings: MasterpieceSettings): string {
	let path = normalizePath(settings.readmePath.trim() || 'README.md');
	if (!/\.md$/i.test(path)) path = `${path}.md`;
	return path;
}

/** 文件夹在前，其次按名称排序 */
export function sortNodes(nodes: VaultNode[]): VaultNode[] {
	nodes.sort((a, b) => {
		if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
		return a.name.localeCompare(b.name, SORT_LOCALE);
	});
	for (const node of nodes) sortNodes(node.children);
	return nodes;
}

export function countNodes(nodes: VaultNode[], stats: TreeStats): void {
	for (const node of nodes) {
		if (node.isFolder) {
			stats.folderCount += 1;
			countNodes(node.children, stats);
		} else {
			stats.fileCount += 1;
		}
	}
}

/** 递归收集所有文件夹节点 */
export function collectFolders(nodes: VaultNode[], out: VaultNode[] = []): VaultNode[] {
	for (const node of nodes) {
		if (node.isFolder) {
			out.push(node);
			collectFolders(node.children, out);
		}
	}
	return out;
}

/**
 * 确保某个文件夹路径在树上存在，父级不存在时递归补齐
 */
function ensureFolderNode(
	path: string,
	root: VaultNode,
	index: Map<string, VaultNode>,
): VaultNode {
	const existing = index.get(path);
	if (existing) return existing;

	const segments = path.split('/');
	const name = segments.pop() ?? path;
	const parentPath = segments.join('/');
	const parent = parentPath ? ensureFolderNode(parentPath, root, index) : root;

	const node: VaultNode = { name, path, isFolder: true, children: [] };
	index.set(path, node);
	parent.children.push(node);
	return node;
}

/**
 * 扫描仓库并把文件、文件夹还原成树结构。
 * 空文件夹同样保留，这样索引能真实反映仓库的骨架。
 * 会自动跳过 Obsidian 配置目录、隐藏目录，以及索引文件自身。
 */
export function buildVaultTree(
	app: App,
	settings: MasterpieceSettings,
	includeAttachments: boolean,
): VaultNode[] {
	const patterns = collectExclusions(app, settings);
	const mocBasename = resolveMocBasename(settings);
	// 索引文件自身不出现在索引里
	const skipPaths = new Set<string>([resolveReadmePath(settings)]);

	const root: VaultNode = { name: '', path: '', isFolder: true, children: [] };
	const folderIndex = new Map<string, VaultNode>([['', root]]);

	const entries = app.vault.getAllLoadedFiles();

	// 先占好文件夹的位置（含空文件夹）
	const folderPaths = entries
		.filter((entry): entry is TFolder => entry instanceof TFolder)
		.map((folder) => folder.path)
		.filter((path) => path && path !== '/' && !isExcluded(path, patterns))
		.sort((a, b) => a.localeCompare(b, SORT_LOCALE));

	for (const path of folderPaths) ensureFolderNode(path, root, folderIndex);

	// 再挂上文件
	const files = entries
		.filter((entry): entry is TFile => entry instanceof TFile)
		.filter((file) => {
			if (isExcluded(file.path, patterns)) return false;
			// MOC 索引已被所属文件夹的链接代表，不再重复罗列
			if (file.extension === 'md' && file.basename === mocBasename) return false;
			if (skipPaths.has(file.path)) return false;
			if (!includeAttachments && file.extension !== 'md') return false;
			return true;
		})
		.sort((a, b) => a.path.localeCompare(b.path, SORT_LOCALE));

	for (const file of files) {
		const parentPath = file.parent?.path ?? '';
		const parent =
			parentPath === '' || parentPath === '/'
				? root
				: ensureFolderNode(parentPath, root, folderIndex);
		parent.children.push({
			name: file.name,
			path: file.path,
			isFolder: false,
			children: [],
			file,
		});
	}

	return sortNodes(root.children);
}

/**
 * 生成 Obsidian 双链。取仓库内最短唯一路径，必要时补显示别名。
 */
export function toWikiLink(app: App, file: TFile, sourcePath: string): string {
	const linkText = app.metadataCache.fileToLinktext(file, sourcePath, true);
	const display = file.extension === 'md' ? file.basename : file.name;
	// 别名里的 | 会破坏双链语法，遇到就退化成裸链接
	if (linkText !== display && !display.includes('|')) {
		return `[[${linkText}|${display}]]`;
	}
	return `[[${linkText}]]`;
}

/** 指向某个文件夹 MOC 的双链，显示名是文件夹名 */
export function toMocLink(
	folderPath: string,
	folderName: string,
	mocBasename: string,
): string {
	const target = normalizePath(`${folderPath}/${mocBasename}`);
	if (target === folderName || folderName.includes('|')) return `[[${target}]]`;
	return `[[${target}|${folderName}]]`;
}
