/**
 * 共享常量。README 索引与 MOC 生成都依赖这里的约定。
 */

/** MOC 文件的默认名（不含扩展名） */
export const DEFAULT_MOC_FILENAME = '_MOC';

/** 自动生成根 README 时的默认标题 */
export const DEFAULT_README_TITLE = '仓库索引';

/**
 * 手动区 / 自动区的块标记。
 * 这些注释是「文件归属权的凭据」：只有标记齐全的文件才允许被插件改写。
 */
export const MOC_MARKER = {
	headStart: '<!-- mp:auto:head -->',
	headEnd: '<!-- /mp:auto:head -->',
	manualStart: '<!-- mp:manual -->',
	manualEnd: '<!-- /mp:manual -->',
	bodyStart: '<!-- mp:auto:body -->',
	bodyEnd: '<!-- /mp:auto:body -->',
} as const;

/** 首次生成时写进手动区的提示文案 */
export const MOC_MANUAL_HINT =
	'（这一块归你，插件不会改动。可以写复习顺序、重点、心得。）';

/* ── 回看提醒 ──────────────────────────────────────────────── */

/**
 * 复习进度存放在仓库内的隐藏目录，而不是插件目录。
 * 原因：根 .gitignore 排除了整个 .obsidian/plugins/masterpiece-tools，
 * 放插件目录里不会跟着 git 走，换设备就丢进度。
 */
export const REVIEW_DATA_DIR = '.masterpiece';
export const REVIEW_DATA_PATH = '.masterpiece/review.json';
export const REVIEW_BACKUP_PATH = '.masterpiece/review.bak.json';
export const REVIEW_FILE_VERSION = 1;

/** 艾宾浩斯间隔（天）。走完这一轮后可按常态间隔继续，或毕业。 */
export const DEFAULT_REVIEW_INTERVALS = [1, 1, 2, 3, 8, 15, 60, 90];

/**
 * 走完全部间隔后的常态回看间隔。
 * 默认 180 = 上面序列的总天数，也就是最后一次回看所在的累计天数。
 */
export const DEFAULT_REVIEW_ONGOING_INTERVAL = 180;
