import { moment } from 'obsidian';

/**
 * 展示层格式化。
 *
 * 全部走 Intl，不写死格式串：日期跟随界面语言，跨年时自动带上年份，
 * 体积按区域加千位分隔。
 *
 * 边界：写进文件的数据格式（review.json 里的 YYYY-MM-DD、README 的更新时间戳）
 * 不在这里。那些是数据契约与文档内容，需要稳定、可排序、可 diff，
 * 不能跟着显示语言变 —— 显示归 Intl，存储归 moment。
 */

/**
 * 用 Obsidian 的界面语言作为 Intl 区域，而不是操作系统的区域 ——
 * 应用内语言和系统区域常常不一致（中文界面 + 英文系统是常见组合）。
 * moment 的 locale 值本身就是合法的 BCP 47 标签（zh-cn、en-gb），可以直接用。
 */
function resolveLocale(): string | undefined {
	try {
		return moment.locale() || undefined;
	} catch {
		return undefined;
	}
}

const LOCALE = resolveLocale();

/**
 * 构造 Intl 实例，区域不被支持时退回运行环境默认区域。
 *
 * 这一步必须包住：这些实例是在模块顶层创建的，
 * 一旦抛错就是插件加载失败 —— 为了一个日期格式把整个插件弄挂不值得。
 */
function safeFormatter<T>(build: (locale: string | undefined) => T): T {
	try {
		return build(LOCALE);
	} catch {
		return build(undefined);
	}
}

function dateTimeFormatter(withYear: boolean): Intl.DateTimeFormat {
	const options: Intl.DateTimeFormatOptions = withYear
		? {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			}
		: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

	return safeFormatter((locale) => new Intl.DateTimeFormat(locale, options));
}

function dayFormatter(withYear: boolean): Intl.DateTimeFormat {
	const options: Intl.DateTimeFormatOptions = withYear
		? { year: 'numeric', month: 'short', day: 'numeric' }
		: { month: 'short', day: 'numeric' };

	return safeFormatter((locale) => new Intl.DateTimeFormat(locale, options));
}

const dateTimeCache = new Map<boolean, Intl.DateTimeFormat>([
	[true, dateTimeFormatter(true)],
	[false, dateTimeFormatter(false)],
]);

const dayCache = new Map<boolean, Intl.DateTimeFormat>([
	[true, dayFormatter(true)],
	[false, dayFormatter(false)],
]);

const timeFormatter = safeFormatter(
	(locale) =>
		new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
);

/** 体积的门槛与单位。GB 不能少：附件里真的有几百 MB 的 PDF 和视频。 */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

const numberFormatter = safeFormatter(
	(locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
);

function isSameYear(date: Date): boolean {
	return date.getFullYear() === new Date().getFullYear();
}

/**
 * 时间戳 → 可读的日期时间。
 * 不显示年份会有歧义（03-10 是三月十号还是十月三号？），
 * 所以非当年的记录一律带上年份。
 */
export function formatDateTime(timestamp: number): string {
	const date = new Date(timestamp);
	return dateTimeCache
		.get(!isSameYear(date))
		?.format(date) ?? date.toISOString();
}

/** 时间戳 → 只取时分，用于写进笔记的捕获时间戳 */
export function formatTimeOfDay(timestamp: number): string {
	return timeFormatter.format(new Date(timestamp));
}

/**
 * 把 'YYYY-MM-DD' 这种存储键解析成本地时间的 Date。
 * 不直接 new Date(key)：那会按 UTC 解析，东八区以西会整体差一天。
 */
function parseDayKey(key: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
	if (!match) return null;
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** 日期键 → 可读的日期，同样在跨年时补上年份 */
export function formatDayKey(key: string): string {
	const date = parseDayKey(key);
	if (!date) return key;
	return dayCache.get(!isSameYear(date))?.format(date) ?? key;
}

/**
 * 字节数 → 可读体积。
 * 单位按 1024 递进，用到 GB；整数不显示多余的 .0；
 * 字节数带千位分隔（12,345 B 比 12345 B 好读）。
 */
export function formatSize(bytes: number | null): string {
	if (bytes === null) return '';

	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}

	// 先按一位小数取整，再吃掉整数末尾的 .0，避免出现 "1.0 MB"
	const rounded = Number(value.toFixed(unit === 0 ? 0 : 1));
	return `${numberFormatter.format(rounded)} ${SIZE_UNITS[unit]}`;
}
