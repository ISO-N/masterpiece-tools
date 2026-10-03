import type { CardActions } from '../card-types';
import {
	applyChapterNumbering,
	scanChapterNumbering,
	type ChapterScanResult,
} from '../../features/chapter-numbering';
import { createCount } from '../ui/controls';

/** 让浏览器先把状态画出来，再开始同步的重活 */
function nextTick(): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, 0);
	});
}

/**
 * 章节编号规范化：先扫描出方案给用户看，确认后才执行改名。
 * 绝不自动直接改 —— 改名是不可逆操作的入口，必须让人过目。
 *
 * 扫描与改名都是重活，期间两个按钮都会禁用：
 * 重复点「应用」会把同一批改名跑两遍。
 */
export function mountChapterPanel(container: HTMLElement, actions: CardActions): void {
	const toolbar = container.createDiv({ cls: 'mp-panel-toolbar' });
	const scanButton = toolbar.createEl('button', {
		text: '扫描',
		attr: { type: 'button' },
	});
	const applyButton = toolbar.createEl('button', {
		cls: 'mod-cta',
		text: '应用',
		attr: { type: 'button' },
	});

	// role=status：扫描结果与改名结果都要能被播报
	const summary = container.createDiv({
		cls: 'mp-panel-summary',
		attr: { role: 'status' },
	});
	const listEl = container.createDiv({ cls: 'mp-preview' });

	let plan: ChapterScanResult | null = null;
	let busy = false;

	const updateApplyButton = (): void => {
		const count = plan?.items.length ?? 0;
		applyButton.setText(count > 0 ? `应用 ${count} 项改名` : '无需改名');
		applyButton.disabled = busy || count === 0;
	};

	const setBusy = (value: boolean, label?: string): void => {
		busy = value;
		scanButton.disabled = value;
		if (value) {
			applyButton.disabled = true;
			if (label) summary.setText(label);
			return;
		}
		updateApplyButton();
	};

	const renderPlan = (): void => {
		listEl.empty();
		if (!plan) return;

		for (const item of plan.items) {
			// 文件名是标识符，禁止浏览器自动翻译把编号改掉
			const row = listEl.createDiv({
				cls: 'mp-preview-item',
				attr: { translate: 'no' },
			});
			row.createSpan({ cls: 'mp-preview-from', text: item.name });
			row.createSpan({ cls: 'mp-preview-arrow', text: '→' });
			row.createSpan({ cls: 'mp-preview-to', text: item.targetName });
		}

		for (const item of plan.conflicts) {
			const row = listEl.createDiv({
				cls: 'mp-preview-item is-conflict',
				attr: { translate: 'no' },
			});
			row.createSpan({ cls: 'mp-preview-from', text: item.name });
			row.createSpan({ cls: 'mp-preview-arrow is-skip', text: '跳过' });
			row.createSpan({ cls: 'mp-preview-to', text: item.conflict ?? '' });
		}
	};

	const renderSummary = (): void => {
		summary.empty();
		summary.removeClass('is-muted');

		if (!plan) {
			summary.setText('先扫描一次，看看哪些笔记的章节编号需要补零。');
			summary.addClass('is-muted');
			return;
		}

		if (plan.matched === 0) {
			summary.setText('没有发现「第 N 章」这类章节命名。');
			summary.addClass('is-muted');
			return;
		}

		createCount(summary, plan.scanned, '篇已扫描');
		createCount(summary, plan.matched, '篇命中章节');
		createCount(summary, plan.items.length, '篇可改名');
		if (plan.conflicts.length > 0) {
			createCount(summary, plan.conflicts.length, '篇有冲突');
		}
		if (plan.items.length > 0) {
			summary.createSpan({
				cls: 'mp-summary-note',
				text: `编号补零到 ${plan.padWidth} 位`,
			});
		}
	};

	async function scan(): Promise<void> {
		if (busy) return;
		setBusy(true, '扫描中…');
		// 同步扫描会占住主线程，先让「扫描中…」渲染出来
		await nextTick();

		try {
			plan = scanChapterNumbering(actions.plugin.app);
			renderPlan();
			renderSummary();
		} finally {
			setBusy(false);
		}
	}

	async function apply(items: ChapterScanResult['items']): Promise<void> {
		setBusy(true, '改名中…');
		applyButton.setText('改名中…');

		try {
			await actions.run(async () => {
				const result = await applyChapterNumbering(actions.plugin.app, items);
				const failed =
					result.failed.length > 0 ? `，失败 ${result.failed.length} 篇` : '';
				return {
					ok: result.failed.length === 0,
					message: `已规范化 ${result.renamed} 篇笔记的章节编号${failed}（双链已同步更新）`,
				};
			});

			// 改名后重新扫描，清掉已经处理完的条目
			plan = scanChapterNumbering(actions.plugin.app);
			renderPlan();
			renderSummary();
		} finally {
			setBusy(false);
		}
	}

	scanButton.addEventListener('click', () => {
		void scan();
	});

	applyButton.addEventListener('click', () => {
		if (busy || !plan || plan.items.length === 0) return;
		void apply(plan.items);
	});

	updateApplyButton();
	renderSummary();
}
