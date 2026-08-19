import type { Snippet } from '../editor/snippets';

export interface FileWriteResponse {
  saved: boolean;
  timestamp: number;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: TreeNode[];
}

export interface SearchHit {
  line: number;
  text: string;
}

export interface SearchResult {
  path: string;
  hits: SearchHit[];
}

export interface EditorConfig {
  font_size: number;
  tab_size: number;
  workspace?: string;
}

async function getToken(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

export async function readFile(path: string): Promise<string> {
  const token = await getToken();
  const res = await fetch(`/api/file/read?path=${encodeURIComponent(path)}&token=${token}`);
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  return res.text();
}

export async function writeFile(path: string, content: string, baseHash: string): Promise<FileWriteResponse> {
  const token = await getToken();
  const res = await fetch(`/api/file/write?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, base_hash: baseHash }),
  });
  if (!res.ok) throw new Error(`write failed: ${res.status}`);
  return res.json();
}

export async function listFiles(path: string = ''): Promise<FileEntry[]> {
  const token = await getToken();
  const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}&token=${token}`);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return res.json();
}

export async function fetchTree(): Promise<TreeNode[]> {
  const token = await getToken();
  const res = await fetch(`/api/files/tree?token=${token}`);
  if (!res.ok) throw new Error(`tree failed: ${res.status}`);
  return res.json();
}

export async function createFile(path: string): Promise<FileWriteResponse> {
  return writeFile(path, '', '');
}

export async function deleteFile(path: string): Promise<void> {
  const token = await getToken();
  const res = await fetch(`/api/file?path=${encodeURIComponent(path)}&token=${token}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

export async function searchFiles(q: string): Promise<SearchResult[]> {
  const token = await getToken();
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&token=${token}`);
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json();
}

export async function fetchSnippets(): Promise<Snippet[]> {
  const token = await getToken();
  const res = await fetch(`/api/snippets?token=${token}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchShortcuts(): Promise<Record<string, string>> {
  const token = await getToken();
  const res = await fetch(`/api/shortcuts?token=${token}`);
  if (!res.ok) return {};
  return res.json();
}

export async function fetchConfig(): Promise<EditorConfig> {
  const token = await getToken();
  const res = await fetch(`/api/config?token=${token}`);
  if (!res.ok) return { font_size: 15, tab_size: 2 };
  return res.json();
}

export async function setToken(token: string): Promise<void> {
  const current = await getToken();
  const res = await fetch(`/api/settings/token?token=${current}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error((await res.text()) || `设置失败: ${res.status}`);
}

export async function setWorkspace(workspace: string): Promise<string> {
  const token = await getToken();
  const res = await fetch(`/api/settings/workspace?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace }),
  });
  if (!res.ok) throw new Error((await res.text()) || `切换失败: ${res.status}`);
  return res.json();
}

/** 打开系统原生文件夹选择器，返回选中路径或 null（用户取消） */
export async function browseFolder(): Promise<string | null> {
  const token = await getToken();
  const res = await fetch(`/api/settings/browse-folder?token=${token}`);
  if (!res.ok) throw new Error(`浏览失败: ${res.status}`);
  return res.json();
}

export async function exportHtml(path: string, html: string): Promise<string> {
  const token = await getToken();
  const res = await fetch(`/api/export/html?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, html }),
  });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  return res.text();
}
