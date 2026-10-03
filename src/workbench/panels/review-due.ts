import type { DueItem } from '../../features/review';
import { createNoteLink } from '../ui/controls';

export interface DueHandlers {
	openNote(path: string): void;
	/** 已回看，推进到下一轮 */
	advance(path: string): void;
	/** 计划走完后选择常态循环 */
	keepGoing(path: string): void;
	/** 计划走完后选择毕业 */
	graduate(path: string): void;
}

/**
 * 待回看列表。逾期最久的排最前 —— 排序是数据层的职责，这里只负责画。
 *
 * 会清空 parent，调用方要给一个专属容器，别和别的元素共用。
 */
export function renderDueList(
	parent: HTMLElement,
	due: DueItem[],
	ongoingInterval: number,
	handlers: DueHandlers,
): void {
	parent.empty();
	for (const item of due) buildDueRow(parent, item, ongoingInterval, handlers);
}

function buildDueRow(
	parent: HTMLElement,
	item: DueItem,
	ongoingInterval: number,
	handlers: DueHandlers,
): void {
	const row = parent.createDiv({ cls: 'mp-row' });
	const main = row.createDiv({ cls: 'mp-row-main' });

	createNoteLink(main, {
		name: item.name,
		path: item.path,
		onOpen: () => handlers.openNote(item.path),
	});

	const ongoing = item.record.state === 'ongoing';
	const meta = main.createDiv({ cls: 'mp-row-meta' });
	meta.createSpan({
		text: ongoing
			? `常态回看，已完成 ${item.record.reviews} 次`
			: `第 ${item.round} 次 / 共 ${item.totalRounds} 次`,
	});

	// 到期状态单独成块并上色：这是整行里唯一需要立刻判断的信息
	const dueTag = meta.createSpan({ cls: 'mp-due-tag' });
	if (item.overdueDays > 0) {
		dueTag.setText(`逾期 ${item.overdueDays} 天`);
		dueTag.addClass('is-overdue');
	} else {
		dueTag.setText('今天到期');
	}

	if (item.needsChoice && !ongoing) {
		meta.createSpan({ cls: 'mp-row-hint', text: '计划内最后一次' });
	}

	const actions = row.createDiv({ cls: 'mp-row-actions' });

	if (item.needsChoice) {
		// 计划走完了，交给用户选：常态循环还是毕业
		actions
			.createEl('button', {
				cls: 'mod-cta mp-btn-sm',
				text: `继续 ${ongoingInterval} 天`,
				attr: { type: 'button' },
			})
			.addEventListener('click', () => handlers.keepGoing(item.path));
		actions
			.createEl('button', {
				cls: 'mp-btn-sm',
				text: '毕业',
				attr: { type: 'button' },
			})
			.addEventListener('click', () => handlers.graduate(item.path));
		return;
	}

	actions
		.createEl('button', {
			cls: 'mod-cta mp-btn-sm',
			text: '已回看',
			attr: { type: 'button' },
		})
		.addEventListener('click', () => handlers.advance(item.path));
}
