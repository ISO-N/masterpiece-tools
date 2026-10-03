import type { CardActions } from '../card-types';
import {
	scanOrphanAttachments,
	type AttachmentScanResult,
} from '../../features/attachments';
import { formatSize } from '../../utils/format';
import { createCount, createNoteLink } from '../ui/controls';

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
		attr: { type: 'button' },
	});

	// role=status：扫描结果要能被播报
	const resultEl = container.createDiv({
		cls: 'mp-attach-result',
		attr: { role: 'status' },
	});

	let scanning = false;

	const setMessage = (text: string, cls?: string): void => {
		resultEl.empty();
		const el = resultEl.createDiv({ cls: 'mp-attach-summary' });
		el.setText(text);
		if (cls) el.addClass(cls);
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
		createCount(head, result.orphans.length, '个未被引用', 'is-warn');
		createCount(head, result.total, '个附件总数');
		createCount(head, formatSize(result.orphanBytes), '可腾出空间');
		if (result.skipped > 0) {
			head.createSpan({
				cls: 'mp-attach-skipped',
				text: `按排除规则跳过 ${result.skipped} 个`,
			});
		}

		const list = resultEl.createDiv({ cls: 'mp-attach-list' });
		for (const item of result.orphans.slice(0, MAX_ROWS)) {
			const row = list.createDiv({ cls: 'mp-row is-compact' });
			const main = row.createDiv({ cls: 'mp-row-main' });

			createNoteLink(main, {
				name: item.name,
				path: item.path,
				onOpen: () => void openAttachment(item.path),
			});

			main.createDiv({
				cls: 'mp-row-meta',
				text: item.folder || '仓库根目录',
				attr: { translate: 'no' },
			});

			row.createSpan({ cls: 'mp-attach-size', text: formatSize(item.size) });
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

	const runScan = async (): Promise<void> => {
		// 扫描期间禁用按钮：重复触发会同时跑两遍全仓库扫描
		if (scanning) return;
		scanning = true;
		scanButton.disabled = true;
		scanButton.setText('扫描中…');
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
					message:
						result.orphans.length > 0
							? `${result.total} 个附件中有 ${result.orphans.length} 个未被引用，合计 ${formatSize(result.orphanBytes)}`
							: `全部 ${result.total} 个附件都有引用`,
				};
			});

			if (outcome === null || !outcome.ok) {
				setMessage('扫描失败，详情见上方状态行。');
			}
		} finally {
			scanning = false;
			scanButton.disabled = false;
			scanButton.setText('扫描');
		}
	};

	async function openAttachment(path: string): Promise<void> {
		await actions.plugin.app.workspace.openLinkText(path, '', false);
	}

	scanButton.addEventListener('click', () => {
		void runScan();
	});
}
