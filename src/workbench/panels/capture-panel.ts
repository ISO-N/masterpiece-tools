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
			placeholder: '想到什么就写下来，Ctrl + Enter 提交',
		},
	});
	textarea.value = draft;

	const row = container.createDiv({ cls: 'mp-capture-row' });

	const select = row.createEl('select', { cls: 'dropdown mp-capture-target' });
	const inboxOption = select.createEl('option', {
		text: `收集箱 · ${resolveInboxPath(actions.plugin.settings)}`,
	});
	inboxOption.value = 'inbox';
	const currentOption = select.createEl('option', { text: '当前打开的笔记' });
	currentOption.value = 'current';

	const submit = row.createEl('button', {
		cls: 'mod-cta mp-capture-submit',
		text: '捕获',
	});

	const run = async (): Promise<void> => {
		const raw = textarea.value;
		if (!raw.trim()) {
			textarea.focus();
			return;
		}

		const target = select.value as CaptureTarget;
		const result = await actions.run(() =>
			captureText(actions.plugin.app, actions.plugin.settings, target, raw),
		);

		if (result?.ok) {
			draft = '';
			textarea.value = '';
		}
		textarea.focus();
	};

	textarea.addEventListener('input', () => {
		draft = textarea.value;
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
