import type { CardActions } from '../card-types';
import {
	formatSize,
	scanOrphanAttachments,
	type AttachmentScanResult,
} from '../../features/attachments';

/** 列表最多铺多少行，避免几千个附件把侧边栏撑爆 */
const MAX_ROWS = 80;

/**
 * 幽灵附件面板：列出没有任何笔记引用的附件。
 *
 * 只做检查，不提供删除 —— 删文件这种不可逆操作不放进侧边栏。
 */
export function mountAttachmentPanel(
	container: HTMLElement,
	actions: CardActions,
): void {
	const toolbar = container.createDiv({ cls: 'mp-panel-toolbar' });
	const scanButton = toolbar.createEl('button', {
		cls: 'mod-cta',
		text: '扫描',
	});

	const resultEl = container.createDiv({ cls: 'mp-attach-result' });

	const setMessage = (text: string, cls?: string): void => {
		resultEl.empty();
		const el = resultEl.createDiv({ cls: 'mp-attach-summary' });
		el.setText(text);
		if (cls) el.addClass(cls);
	};

	let scanning = false;

	const runScan = async (): Promise<void> => {
		if (scanning) return;
		scanning = true;
		scanButton.disabled = true;
		setMessage('扫描中…');

		try {
			const outcome = await actions.run(async () => {
				const result = await scanOrphanAttachments(
					actions.plugin.app,
					actions.plugin.settings,
				);
				renderResult(result);
				return {
					ok: true,
					message: result.orphans.length > 0
						? `${result.total} 个附件中 ${result.orphans.length} 个未被引用 · 合计 ${formatSize(result.orphanBytes)}`
						: `全部 ${result.total} 个附件都有引用`,
				};
			});

			if (outcome === null || !outcome.ok) {
				setMessage('扫描失败，详情见上方状态行。');
			}
		} finally {
			scanning = false;
			scanButton.disabled = false;
		}
	};

	const renderResult = (result: AttachmentScanResult): void => {
		resultEl.empty();

		if (result.total === 0) {
			setMessage('仓库里还没有附件。');
			return;
		}

		if (result.orphans.length === 0) {
			setMessage(`全部 ${result.total} 个附件都有引用，没有需要清理的。`, 'is-clear');
			return;
		}

		const head = resultEl.createDiv({ cls: 'mp-attach-summary' });
		head.createSpan({
			cls: 'mp-attach-count',
			text: `${result.orphans.length} 个未被引用`,
		});
		head.createSpan({
			text: ` / 共 ${result.total} 个 · 可清理 ${formatSize(result.orphanBytes)}`,
		});
		if (result.skipped > 0) {
			head.createSpan({
				cls: 'mp-attach-skipped',
				text: ` · 已按排除规则跳过 ${result.skipped} 个`,
			});
		}

		const list = resultEl.createDiv({ cls: 'mp-attach-list' });
		for (const item of result.orphans.slice(0, MAX_ROWS)) {
			const row = list.createDiv({ cls: 'mp-attach-row' });

			const main = row.createDiv({ cls: 'mp-review-row-main' });
			const nameEl = main.createDiv({ cls: 'mp-review-row-name' });
			nameEl.setText(item.name);
			nameEl.addEventListener('click', () => {
				void openAttachment(item.path);
			});
			main.createDiv({
				cls: 'mp-review-row-meta',
				text: item.folder || '仓库根目录',
			});

			row.createSpan({
				cls: 'mp-attach-size',
				text: formatSize(item.size),
			});
		}

		if (result.orphans.length > MAX_ROWS) {
			resultEl.createDiv({
				cls: 'mp-empty',
				text: `还有 ${result.orphans.length - MAX_ROWS} 个未列出`,
			});
		}

		resultEl.createDiv({
			cls: 'mp-attach-note',
			text: '这里只做检查，不会移动或删除任何文件。',
		});
	};

	async function openAttachment(path: string): Promise<void> {
		await actions.plugin.app.workspace.openLinkText(path, '', false);
	}

	scanButton.addEventListener('click', () => {
		void runScan();
	});
}
