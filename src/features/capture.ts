import { App, TFile, moment, normalizePath } from 'obsidian';
import type { MasterpieceSettings } from '../settings';

export type CaptureTarget = 'inbox' | 'current';

export interface CaptureResult {
	ok: boolean;
	message: string;
	/** 实际写入的笔记路径 */
	path: string | null;
}

/** 收集箱路径，缺省 README 时补 .md */
export function resolveInboxPath(settings: MasterpieceSettings): string {
	let path = normalizePath(settings.inboxPath.trim() || '收集箱.md');
	if (!/\.md$/i.test(path)) path = `${path}.md`;
	return path;
}

/** 当前打开的可写笔记 */
function resolveActiveNote(app: App): TFile | null {
	const file = app.workspace.getActiveFile();
	if (file && file.extension === 'md') return file;
	return null;
}

/**
 * 把内容追加到收集箱或当前笔记。
 * 输入的多行会拆成多条列表项，方便之后逐条整理。
 */
export async function captureText(
	app: App,
	settings: MasterpieceSettings,
	target: CaptureTarget,
	raw: string,
): Promise<CaptureResult> {
	const lines = raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return { ok: false, message: '没有内容可捕获', path: null };
	}

	let file: TFile | null = null;
	let created = false;

	if (target === 'current') {
		file = resolveActiveNote(app);
		if (!file) {
			return { ok: false, message: '当前没有打开的笔记', path: null };
		}
	} else {
		const path = resolveInboxPath(settings);
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			file = existing;
		} else {
			file = await createInbox(app, path);
			created = true;
		}
	}

	const stamp = settings.captureTimestamp ? `${moment().format('HH:mm')} ` : '';
	const block = lines.map((line) => `- ${stamp}${line}`).join('\n') + '\n';

	const content = await app.vault.read(file);
	// 保证与既有内容之间留出空行，避免粘在上一段后面
	const separator =
		content.length === 0
			? ''
			: content.endsWith('\n\n')
				? ''
				: content.endsWith('\n')
					? '\n'
					: '\n\n';

	await app.vault.append(file, separator + block);

	return {
		ok: true,
		message: `已捕获 ${lines.length} 条到 ${file.path}${created ? '（新建）' : ''}`,
		path: file.path,
	};
}

/** 首次使用时创建收集箱 */
async function createInbox(app: App, path: string): Promise<TFile> {
	const parent = path.split('/').slice(0, -1).join('/');
	if (parent && !app.vault.getAbstractFileByPath(parent)) {
		try {
			await app.vault.createFolder(parent);
		} catch {
			// 并发创建时可能已存在
		}
	}

	const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
	const content = [
		`# ${name}`,
		'',
		'> [!tip] 由 Masterpiece Workbench 快速捕获写入',
		'> 这里是碎片想法的暂存处，攒够了再整理进正式笔记。',
		'',
		'',
	].join('\n');

	return app.vault.create(path, content);
}
