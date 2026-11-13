interface FoldSettings {
  enabled: boolean;
  defaultCollapsed: boolean;
  userEnabled: boolean;
  userLines: number;
}

type DOMScope = Document | ShadowRoot;
type ScopeKind = 'document' | 'shadow' | 'frame';
interface ScanError { stage: string; name: string }
interface DOMDiscovery {
  roots: { root: DOMScope; kind: ScopeKind; depth: number }[];
  inaccessibleFrames: number;
  closedShadowRoots: number;
  scanErrors: { type: string; count: number }[];
}
interface DOMAccess {
  errorName(value: unknown): string;
  scan(document: Document): DOMDiscovery;
  parent(element: Element): Element | null;
  contains(ancestor: Element, element: Element): boolean;
  compare(left: Element, right: Element): number;
}

interface AnswerDescriptor {
  element: Element;
  elements?: Element[];
  key: string | null;
}
interface ProviderAdapter {
  id: string;
  label: string;
  matches(location: Location): boolean;
  findAnswers(document: Document, scopes?: DOMDiscovery): AnswerDescriptor[];
  findUserMessages?(document: Document, scopes?: DOMDiscovery): { element: HTMLElement; key: string | null }[];
  diagnose?(document: Document): Record<string, unknown>;
}
interface AdapterRegistry {
  defaults: FoldSettings;
  register(adapter: ProviderAdapter): void;
  resolve(location: Location): ProviderAdapter | undefined;
}

interface EngineFailure { stage: string; name: string }
interface FoldRuntime {
  protocol: 2;
  version: string;
  readonly error: EngineFailure | null;
  destroy(): void;
}
interface FoldStatus {
  protocol: 2;
  version: string;
  error: EngineFailure | null;
  provider: string;
  enabled: boolean;
  total: number;
  collapsed: number;
  users: UserFoldStatus;
  index?: CatalogStatus;
}

interface UserFoldStatus { enabled: boolean; lines: number; total: number; collapsed: number; anonymousTotal?: number; anonymousCollapsed?: number; }
interface UserFoldController {
  reconcile(settings: FoldSettings, discovery: DOMDiscovery): void;
  status(): UserFoldStatus;
  setAll(collapsed: boolean): void;
  contains(node: Node): boolean;
  affectsLayout(node: Node): boolean;
  ignoreMutation(mutation: MutationRecord): boolean;
  reset(): void;
  destroy(): void;
}
interface UserFoldFactory {
  css: string;
  create(adapter: ProviderAdapter, document: Document, schedule: () => void, history?: FoldHistory): UserFoldController;
}

interface AnswerState {
  element: Element;
  targets: Set<Element>;
  key: string;
  collapsed: boolean;
  index: number;
  stateKey: string | null;
}
interface AnswerRecord extends AnswerState {
  host: HTMLDivElement;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  number: HTMLSpanElement;
}

interface StructureSummary {
  articles: number;
  turns: number;
  modernTurns: number;
  activeModernTurns: number;
  markdownBlocks: number;
  controls: number;
  userControls: number;
  frames: number;
  roles: Record<string, Record<string, number>>;
}
interface DiagnosticResponse {
  error?: string;
  phase?: string;
  exception?: { name: string };
  extensionVersion?: string;
  pageVersion?: string | null;
  protocol?: number | null;
  legacyScript?: boolean;
  engineError?: EngineFailure | null;
  readyState?: DocumentReadyState;
  structure?: StructureSummary;
  nested?: {
    scanErrors: DOMDiscovery['scanErrors'];
    inaccessibleFrames: number;
    closedShadowRoots: number;
    contexts: (StructureSummary & { kind: ScopeKind; depth: number })[];
  };
}

declare var ChatFoldDOM: DOMAccess;
declare var ChatFold: AdapterRegistry;
declare var __chatFoldRuntime: FoldRuntime | undefined;
declare var ChatFoldProbe: (() => DiagnosticResponse) | undefined;
declare var ChatFoldUsers: UserFoldFactory;

interface FoldHistory {
  load(): Promise<void>;
  entries(): [string, unknown][];
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  key(kind: 'answer' | 'user', message: string | null): string | null;
  get(key: string | null): boolean | undefined;
  set(key: string | null, collapsed: boolean): void;
  remember(key: string | null, collapsed: boolean): void;
  update(changes: Record<string, chrome.storage.StorageChange>): boolean;
}
declare var ChatFoldHistory: { create(provider: string): FoldHistory };

type MessageKind = 'answer' | 'user';
interface CatalogStatus { complete: boolean; verifiedAt: number | null; verifying: boolean; result?: string | null; }
interface ConversationCatalog {
  observe(kind: MessageKind, ids: string[]): void;
  ids(kind: MessageKind): string[];
  count(kind: MessageKind, fallback: boolean): { total: number; collapsed: number };
  setAll(kind: MessageKind, collapsed: boolean): void;
  confirm(answers: string[], users: string[]): void;
  invalidate(): void;
  status(): CatalogStatus;
  refresh(): void;
}
declare var ChatFoldCatalog: { create(history: FoldHistory, provider: string): ConversationCatalog };

interface VerificationResult { answers: string[]; users: string[]; complete: boolean; }
declare var ChatFoldVerify: { run(adapter: ProviderAdapter, signal: AbortSignal, collect: (answers: string[], users: string[]) => void): Promise<VerificationResult> };
