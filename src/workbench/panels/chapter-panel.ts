import type { CardActions } from '../card-types';
import {
	applyChapterNumbering,
	scanChapterNumbering,
	type ChapterScanResult,
} from '../../features/chapter-numbering';

/**
 * 章节编号规范化：先扫描出方案给用户看，确认后才执行改名。
 * 绝不自动直接改，改名是不可逆操作的入口，必须让人过目。
 */
export function mountChapterPanel(container: HTMLElement, actions: CardActions): void {
	const toolbar = container.createDiv({ cls: 'mp-panel-toolbar' });
	const scanButton = toolbar.createEl('button', { text: '扫描' });
	const applyButton = toolbar.createEl('button', {
		cls: 'mod-cta',
		text: '应用',
	});
	applyButton.disabled = true;

	const summary = container.createDiv({ cls: 'mp-panel-summary' });
	const listEl = container.createDiv({ cls: 'mp-preview' });

	let plan: ChapterScanResult | null = null;

	const renderPlan = (): void => {
		listEl.empty();
		if (!plan) return;

		for (const item of plan.items) {
			const row = listEl.createDiv({ cls: 'mp-preview-item' });
			row.createSpan({ cls: 'mp-preview-from', text: item.name });
			row.createSpan({ cls: 'mp-preview-arrow', text: '→' });
			row.createSpan({ cls: 'mp-preview-to', text: item.targetName });
		}

		for (const item of plan.conflicts) {
			const row = listEl.createDiv({ cls: 'mp-preview-item is-conflict' });
			row.createSpan({ cls: 'mp-preview-from', text: item.name });
			row.createSpan({ cls: 'mp-preview-arrow', text: '跳过' });
			row.createSpan({ cls: 'mp-preview-to', text: item.conflict ?? '' });
		}
	};

	const updateAfterScan = (): void => {
		if (!plan) return;
		const parts = [
			`扫描 ${plan.scanned} 篇笔记`,
			`命中 ${plan.matched} 篇章节命名`,
			`可改名 ${plan.items.length} 篇`,
		];
		if (plan.conflicts.length > 0) parts.push(`冲突 ${plan.conflicts.length} 篇`);
		if (plan.items.length > 0) parts.push(`补零到 ${plan.padWidth} 位`);

		summary.setText(parts.join(' · '));
		summary.removeClass('is-muted');

		applyButton.setText(
			plan.items.length > 0 ? `应用 ${plan.items.length} 项改名` : '无需改名',
		);
		applyButton.disabled = plan.items.length === 0;
	};

	scanButton.addEventListener('click', () => {
		plan = scanChapterNumbering(actions.plugin.app);
		renderPlan();
		updateAfterScan();

		if (plan.matched === 0) {
			summary.setText('没有发现「第 N 章」这类章节命名。');
			summary.addClass('is-muted');
		}
	});

	applyButton.addEventListener('click', () => {
		if (!plan || plan.items.length === 0) return;
		const items = plan.items;
		void actions
			.run(async () => {
				const result = await applyChapterNumbering(actions.plugin.app, items);
				const failed =
					result.failed.length > 0 ? `，失败 ${result.failed.length} 篇` : '';
				return {
					ok: result.failed.length === 0,
					message: `已规范化 ${result.renamed} 篇笔记的章节编号${failed}（双链已同步更新）`,
				};
			})
			.then(() => {
				// 改名后重新扫描，清掉已经处理完的条目
				plan = scanChapterNumbering(actions.plugin.app);
				renderPlan();
				updateAfterScan();
			});
	});
}
