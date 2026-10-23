export type RuleField = 'from' | 'to' | 'subject' | 'body';
export type RuleOp = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith';
export type RuleActionType = 'markRead' | 'star' | 'archive' | 'delete' | 'moveTo';

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string;
}

export interface RuleAction {
  type: RuleActionType;
  folder?: string;
}

export interface MailRule {
  id: string;
  enabled: boolean;
  name: string;
  matchAll: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  createdAt: number;
}

const STORAGE_KEY = 'emeil-rules-v1';

function uid(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadRules(): MailRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as MailRule[];
  } catch {
    /* ignore */
  }
  return [];
}

export function saveRules(rules: MailRule[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function createEmptyRule(): MailRule {
  return {
    id: uid(),
    enabled: true,
    name: 'Nueva regla',
    matchAll: true,
    conditions: [{ field: 'from', op: 'contains', value: '' }],
    actions: [{ type: 'archive' }],
    createdAt: Date.now()
  };
}

function normalize(s: string | null | undefined): string {
  return (s || '').toLowerCase();
}

function matchCondition(mail: any, cond: RuleCondition): boolean {
  const value = normalize(cond.value);
  if (!value) return false;
  let haystack = '';
  if (cond.field === 'from') haystack = normalize(mail.from || mail.sender);
  else if (cond.field === 'to') haystack = normalize(mail.toRecipients || mail.to || '');
  else if (cond.field === 'subject') haystack = normalize(mail.subject);
  else if (cond.field === 'body') haystack = normalize(mail.text || mail.preview || mail.body || '');
  if (cond.op === 'equals') return haystack === value;
  if (cond.op === 'startsWith') return haystack.startsWith(value);
  if (cond.op === 'endsWith') return haystack.endsWith(value);
  if (cond.op === 'notContains') return !haystack.includes(value);
  return haystack.includes(value);
}

export function ruleMatches(mail: any, rule: MailRule): boolean {
  if (!rule.enabled) return false;
  if (!rule.conditions.length) return false;
  if (rule.matchAll) {
    return rule.conditions.every((c) => matchCondition(mail, c));
  }
  return rule.conditions.some((c) => matchCondition(mail, c));
}

export function getMatchingRules(mail: any, rules: MailRule[]): MailRule[] {
  return rules.filter((r) => ruleMatches(mail, r));
}
