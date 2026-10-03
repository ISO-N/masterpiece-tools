import type { CardActions } from '../card-types';
import { captureText, resolveInboxPath, type CaptureTarget } from '../../features/capture';

/**
 * 草稿保存在模块作用域，这样工作台因为别的操作重新渲染时，
 * 已经敲了一半的内容不会被清空。
 */
let draft = '';

export function mountCapturePanel(container: HTMLElement, actions: CardActions): void {
	const textarea = container.createEl('textarea', {
		cls: 'mp-capture-input',
		attr: {
			rows: '3',
			name: 'masterpiece-capture',
			// 非登录字段，关掉自动填充，避免密码管理器弹候选
			autocomplete: 'off',
			placeholder: '想到什么就写下来，Ctrl / ⌘ + Enter 提交…',
			'aria-label': '要捕获的内容',
		},
	});
	textarea.value = draft;

	// 错误紧挨输入框：出问题的地方和说明它的地方不该隔着一屏
	const errorEl = container.createDiv({
		cls: 'mp-capture-error',
		attr: { role: 'status' },
	});

	const row = container.createDiv({ cls: 'mp-capture-row' });

	const select = row.createEl('select', {
		cls: 'dropdown mp-capture-target',
		attr: { name: 'masterpiece-capture-target', 'aria-label': '写入位置' },
	});
	const inboxOption = select.createEl('option', {
		text: `收集箱 · ${resolveInboxPath(actions.plugin.settings)}`,
	});
	inboxOption.value = 'inbox';
	const currentOption = select.createEl('option', { text: '当前打开的笔记' });
	currentOption.value = 'current';

	const submit = row.createEl('button', {
		cls: 'mod-cta mp-capture-submit',
		text: '捕获',
		attr: { type: 'button' },
	});

	/** 防双击 / 连续提交：重复提交会把同一段内容往笔记里追加两遍 */
	let submitting = false;

	const setError = (text: string): void => {
		errorEl.setText(text);
		errorEl.toggleClass('is-hidden', text.length === 0);
	};

	const run = async (): Promise<void> => {
		if (submitting) return;

		const raw = textarea.value;
		if (!raw.trim()) {
			setError('还没有内容。写下至少一行再捕获。');
			textarea.focus();
			return;
		}

		setError('');
		submitting = true;
		submit.disabled = true;
		submit.setText('捕获中…');

		try {
			const target = select.value as CaptureTarget;
			const result = await actions.run(() =>
				captureText(actions.plugin.app, actions.plugin.settings, target, raw),
			);

			if (result?.ok) {
				draft = '';
				textarea.value = '';
			} else if (result) {
				setError(result.message);
			}
		} finally {
			submitting = false;
			submit.disabled = false;
			submit.setText('捕获');
			textarea.focus();
		}
	};

	textarea.addEventListener('input', () => {
		draft = textarea.value;
		// 一开始打字就把错误撤掉，而不是让它挂在那里
		if (errorEl.textContent) setError('');
	});
	textarea.addEventListener('keydown', (event: KeyboardEvent) => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			void run();
		}
	});
	submit.addEventListener('click', () => {
		void run();
	});
}
