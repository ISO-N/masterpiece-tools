import { App, Modal, Setting } from 'obsidian';

export interface ConfirmOptions {
	/** 弹窗标题，用动作本身命名 */
	title: string;
	/** 说明会发生什么，以及能不能撤销 */
	message: string;
	/** 确认按钮文案。要直接说明动作，不要写「确定」 */
	confirmText: string;
	/** 不可撤销的破坏性操作，用警示样式 */
	destructive?: boolean;
}

/**
 * 破坏性操作前的确认框。
 *
 * 返回用户是否确认；取消、按 Esc、点遮罩都算取消。
 * 工作台里的「移除 / 毕业 / 重新开始」都走这里 ——
 * 这些操作会丢掉回看进度，不该一次点击就生效。
 */
export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}

class ConfirmModal extends Modal {
	private readonly options: ConfirmOptions;
	private readonly settle: (value: boolean) => void;
	private settled = false;

	constructor(app: App, options: ConfirmOptions, settle: (value: boolean) => void) {
		super(app);
		this.options = options;
		this.settle = settle;
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl('p', {
			cls: 'mp-confirm-text',
			text: this.options.message,
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('取消').onClick(() => this.finish(false)),
			)
			.addButton((button) => {
				button
					.setButtonText(this.options.confirmText)
					.onClick(() => this.finish(true));
				if (this.options.destructive) button.setWarning();
			});
	}

	onClose(): void {
		this.contentEl.empty();
		// Esc / 点遮罩关闭时当作取消。这里不能再调 close()，会递归。
		if (!this.settled) {
			this.settled = true;
			this.settle(false);
		}
	}

	private finish(value: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.settle(value);
		this.close();
	}
}
