import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCOPE_GROUPS = [
  'mail.read', 'mail.send', 'mail.manage', 'mail.settings',
  'drive.read', 'drive.write',
  'sheets.read', 'sheets.write',
  'docs.read', 'docs.write',
  'calendar.read', 'calendar.write',
  'tasks.read', 'tasks.write',
] as const;
export type ScopeGroup = typeof SCOPE_GROUPS[number];

export interface AccountConfig {
  id: string;
  email: string;
  displayName?: string;
  enabled: boolean;
  credentialPath?: string;
  tokenPath?: string;
  scopeGroups?: ScopeGroup[];
}

export interface AccountsConfig {
  defaultAccount: string | null;
  accounts: AccountConfig[];
}

export interface AccountPaths {
  accountDir: string;
  credentialsPath: string;
  tokenPath: string;
  metaPath: string;
}

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.gmail-multi-mcp');
const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function expandHome(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function getConfigRoot(): string {
  const envPath = process.env.GMAILMCPCONFIG_DIR?.trim() ?? process.env.GMAIL_MCP_CONFIG_DIR?.trim();
  if (!envPath) return DEFAULT_CONFIG_DIR;
  return path.resolve(expandHome(envPath));
}

export function validateAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(
      `Invalid account id "${accountId}". Use letters, numbers, underscores, or hyphens only.`
    );
  }
}

export function getAccountsFilePath(configRoot: string): string {
  return path.join(configRoot, 'accounts.json');
}

export function getDefaultAccountPaths(configRoot: string, accountId: string): AccountPaths {
  const accountDir = path.join(configRoot, 'accounts', accountId);
  return {
    accountDir,
    credentialsPath: path.join(accountDir, 'credentials.json'),
    tokenPath: path.join(accountDir, 'token.json'),
    metaPath: path.join(accountDir, 'meta.json'),
  };
}

export function getAccountPaths(configRoot: string, account: AccountConfig): AccountPaths {
  const defaults = getDefaultAccountPaths(configRoot, account.id);
  return {
    accountDir: defaults.accountDir,
    credentialsPath: account.credentialPath
      ? path.resolve(expandHome(account.credentialPath))
      : defaults.credentialsPath,
    tokenPath: account.tokenPath
      ? path.resolve(expandHome(account.tokenPath))
      : defaults.tokenPath,
    metaPath: defaults.metaPath,
  };
}

/**
 * Write a file containing OAuth material with owner-only permissions.
 *
 * `writeFile`'s `mode` only applies when the file is created, so an existing
 * world-readable file keeps its old permissions on rewrite. The explicit chmod
 * covers that case — the common one here, since both re-authentication and
 * every silent token refresh overwrite a token.json that already exists.
 *
 * These files hold refresh tokens and OAuth client secrets. The default 0644
 * makes them readable by every local user, so on a shared host any compromised
 * service account can read them.
 */
export async function writeSecretFile(filePath: string, contents: string): Promise<void> {
  await fs.writeFile(filePath, contents, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

/** Create a directory that will hold OAuth material, owner-only. */
export async function mkdirSecret(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  await fs.chmod(dirPath, 0o700);
}

export async function ensureConfigLayout(configRoot: string): Promise<void> {
  await mkdirSecret(path.join(configRoot, 'accounts'));
}

function sanitizeAccount(configRoot: string, input: unknown): AccountConfig | null {
  if (!input || typeof input !== 'object') return null;

  const candidate = input as Partial<AccountConfig>;
  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') return null;
  if (typeof candidate.email !== 'string' || candidate.email.trim() === '') return null;

  validateAccountId(candidate.id);

  const defaults = getDefaultAccountPaths(configRoot, candidate.id);

  const rawScopeGroups = (candidate as Record<string, unknown>).scopeGroups;
  const scopeGroups: ScopeGroup[] | undefined = Array.isArray(rawScopeGroups)
    ? rawScopeGroups.filter((s): s is ScopeGroup => (SCOPE_GROUPS as readonly string[]).includes(s as string))
    : undefined;

  return {
    id: candidate.id,
    email: candidate.email,
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName : undefined,
    enabled: Boolean(candidate.enabled),
    credentialPath:
      typeof candidate.credentialPath === 'string'
        ? path.resolve(expandHome(candidate.credentialPath))
        : defaults.credentialsPath,
    tokenPath:
      typeof candidate.tokenPath === 'string'
        ? path.resolve(expandHome(candidate.tokenPath))
        : defaults.tokenPath,
    scopeGroups: scopeGroups && scopeGroups.length > 0 ? scopeGroups : undefined,
  };
}

export async function loadAccountsConfig(configRoot: string): Promise<AccountsConfig> {
  await ensureConfigLayout(configRoot);

  const accountsFilePath = getAccountsFilePath(configRoot);

  try {
    const raw = await fs.readFile(accountsFilePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AccountsConfig>;
    const accountsRaw = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const accounts = accountsRaw
      .map((account) => sanitizeAccount(configRoot, account))
      .filter((account): account is AccountConfig => account !== null);

    const defaultAccount =
      typeof parsed.defaultAccount === 'string' &&
      accounts.some((account) => account.id === parsed.defaultAccount)
        ? parsed.defaultAccount
        : null;

    return {
      defaultAccount,
      accounts,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to read accounts config: ${(error as Error).message}`);
    }

    const emptyConfig: AccountsConfig = {
      defaultAccount: null,
      accounts: [],
    };
    await saveAccountsConfig(configRoot, emptyConfig);
    return emptyConfig;
  }
}

export async function saveAccountsConfig(
  configRoot: string,
  config: AccountsConfig
): Promise<void> {
  await ensureConfigLayout(configRoot);
  const accountsFilePath = getAccountsFilePath(configRoot);
  await fs.writeFile(accountsFilePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function upsertAccount(config: AccountsConfig, nextAccount: AccountConfig): AccountsConfig {
  const existingIndex = config.accounts.findIndex((account) => account.id === nextAccount.id);
  if (existingIndex === -1) {
    return {
      ...config,
      accounts: [...config.accounts, nextAccount],
    };
  }

  const cloned = [...config.accounts];
  cloned[existingIndex] = nextAccount;
  return {
    ...config,
    accounts: cloned,
  };
}
