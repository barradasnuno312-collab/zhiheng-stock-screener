import type { Verdict } from '../../../../shared/api.interface';

export const VERDICT_LABEL: Record<Verdict | 'outside', string> = {
  pass: '入选',
  fail: '排除',
  unknown: '待核实',
  outside: '不在股票池',
};

export function displayTime(value: string | null): string {
  if (!value) return '未提供';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
