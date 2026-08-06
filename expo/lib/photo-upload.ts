import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { supabase } from '@/lib/supabase';
import { resolveSupabaseUrl, resolveSupabaseAnonKey } from '@/lib/supabase-env';

const STORAGE_BUCKET = 'deal-photos';
const MAX_PHOTO_SIZE_MB = 50;
const MAX_DIMENSION = 7680;
const COMPRESSION_QUALITY_WEB = 0.95;
const COMPRESSION_QUALITY_WEB_RETRY = 0.85;
const COMPRESSION_RETRY_DIM_FACTOR = 0.85;
const MAX_WEB_SIZE_KB = 8192;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;
const CONCURRENT_UPLOADS = 3;
const OFFLINE_QUEUE_KEY = '@photo_upload_queue';

let _bucketReady = false;
let _bucketCheckPromise: Promise<boolean> | null = null;
let _lastBucketError = '';

export interface UploadResult {
  url: string | null;
  error: string | null;
}

export interface UploadProgressInfo {
  current: number;
  total: number;
  fileName?: string;
  status: 'uploading' | 'compressing' | 'retrying' | 'done' | 'failed';
}

interface QueuedUpload {
  dealId: string;
  localUri: string;
  index: number;
  queuedAt: number;
}

function getApiBaseUrl(): string {
  return getDirectApiBaseUrl() || (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
}

function generateFilePath(dealId: string, index: number, ext: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `${dealId}/${ts}-${rand}-${index}.${ext}`;
}

function getMimeAndExt(uri: string): { mimeType: string; ext: string } {
  const lower = uri.toLowerCase();
  if (lower.includes('.png') || lower.includes('image/png')) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (lower.includes('.webp') || lower.includes('image/webp')) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  if (lower.includes('.heic') || lower.includes('image/heic')) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  if (lower.includes('.heif') || lower.includes('image/heif')) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  return { mimeType: 'image/jpeg', ext: 'jpg' };
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const waitMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`[PhotoUpload] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed:`, lastError?.message, `— retrying in ${waitMs}ms`);
      if (attempt < MAX_RETRIES - 1) {
        await delay(waitMs);
      }
    }
  }
  throw lastError ?? new Error(`${label} failed after ${MAX_RETRIES} retries`);
}

async function ensureBucketViaRPC(): Promise<boolean> {
  try {
    console.log('[PhotoUpload] Method 1: Calling ensure_deal_photos_bucket() RPC...');
    const { data, error } = await supabase.rpc('ensure_deal_photos_bucket');

    if (error) {
      console.log('[PhotoUpload] RPC ensure_deal_photos_bucket error:', error.message, error.code);
      _lastBucketError = 'RPC: ' + error.message;
      return false;
    }

    const result = data as { success?: boolean; error?: string; message?: string } | null;
    if (result?.success) {
      console.log('[PhotoUpload] RPC bucket ensured:', result.message);
      return true;
    }

    console.log('[PhotoUpload] RPC returned failure:', result?.error || JSON.stringify(result));
    _lastBucketError = 'RPC result: ' + (result?.error || 'unknown');
    return false;
  } catch (err) {
    console.log('[PhotoUpload] ensureBucketViaRPC exception:', (err as Error)?.message);
    _lastBucketError = 'RPC exception: ' + (err as Error)?.message;
    return false;
  }
}

async function ensureBucketViaBackend(): Promise<boolean> {
  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    console.log('[PhotoUpload] Method 2: No API base URL — skipping backend');
    _lastBucketError = 'Backend: No API base URL configured';
    return false;
  }

  try {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log('[PhotoUpload] Method 2: Calling backend /ensure-storage-bucket...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${apiBase}/ensure-storage-bucket`, {
      method: 'POST',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseData = await response.json();
    console.log('[PhotoUpload] Backend response:', response.status, JSON.stringify(responseData).substring(0, 200));

    if (responseData.success) {
      return true;
    }
    _lastBucketError = 'Backend: ' + (responseData.error || 'unknown');
    return false;
  } catch (err) {
    console.log('[PhotoUpload] ensureBucketViaBackend error:', (err as Error)?.message);
    _lastBucketError = 'Backend unreachable: ' + (err as Error)?.message;
    return false;
  }
}

async function ensureBucketViaClient(): Promise<boolean> {
  try {
    console.log('[PhotoUpload] Method 3: Trying client-side bucket creation...');
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_PHOTO_SIZE_MB * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    });
    if (error) {
      if (error.message?.includes('already exists')) {
        console.log('[PhotoUpload] Bucket already exists (client check)');
        return true;
      }
      console.log('[PhotoUpload] Client bucket creation failed:', error.message);
      _lastBucketError = 'Client: ' + error.message;
      return false;
    }
    console.log('[PhotoUpload] Client bucket creation succeeded');
    return true;
  } catch (err) {
    console.log('[PhotoUpload] ensureBucketViaClient error:', (err as Error)?.message);
    _lastBucketError = 'Client exception: ' + (err as Error)?.message;
    return false;
  }
}

async function ensureBucketExists(): Promise<boolean> {
  if (_bucketReady) return true;

  if (_bucketCheckPromise) {
    return _bucketCheckPromise;
  }

  _bucketCheckPromise = (async () => {
    try {
      _lastBucketError = '';

      console.log('[PhotoUpload] === BUCKET CHECK START ===');
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 1 });

      if (!error && data) {
        console.log('[PhotoUpload] Bucket exists and is accessible');
        _bucketReady = true;
        return true;
      }

      console.log('[PhotoUpload] Bucket not accessible:', error?.message);

      const rpcOk = await ensureBucketViaRPC();
      if (rpcOk) {
        console.log('[PhotoUpload] Bucket ensured via RPC (SECURITY DEFINER)');
        _bucketReady = true;
        return true;
      }

      const backendOk = await ensureBucketViaBackend();
      if (backendOk) {
        console.log('[PhotoUpload] Bucket ensured via backend');
        _bucketReady = true;
        return true;
      }

      const clientOk = await ensureBucketViaClient();
      if (clientOk) {
        console.log('[PhotoUpload] Bucket ensured via client');
        _bucketReady = true;
        return true;
      }

      console.log('[PhotoUpload] === ALL 3 BUCKET METHODS FAILED ===');
      console.log('[PhotoUpload] Last error:', _lastBucketError);
      return false;
    } catch (err) {
      console.log('[PhotoUpload] ensureBucketExists exception:', (err as Error)?.message);
      _lastBucketError = 'Exception: ' + (err as Error)?.message;
      return false;
    } finally {
      _bucketCheckPromise = null;
    }
  })();

  return _bucketCheckPromise;
}

function getSupabaseHeaders(): Record<string, string> {
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  return {
    'apikey': supabaseAnonKey,
    'x-upsert': 'true',
    'cache-control': '31536000',
  };
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers = getSupabaseHeaders();
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  try {
    const session = await supabase.auth.getSession();
    const accessToken = session?.data?.session?.access_token;
    headers['Authorization'] = `Bearer ${accessToken || supabaseAnonKey}`;
  } catch {
    headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
  }

  return headers;
}

function buildUploadUrl(filePath: string): string {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  return `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${filePath}`;
}

function getPublicUrl(path: string): UploadResult {
  const { data: publicUrlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  const publicUrl = publicUrlData?.publicUrl;
  if (!publicUrl) {
    console.log('[PhotoUpload] Failed to get public URL for:', path);
    return { url: null, error: 'Failed to get public URL' };
  }

  console.log('[PhotoUpload] SUCCESS:', publicUrl.substring(0, 100));
  return { url: publicUrl, error: null };
}

async function ensureLocalFileUri(photoUri: string, index: number): Promise<string> {
  const { ext } = getMimeAndExt(photoUri);

  if (photoUri.startsWith('data:image/')) {
    console.log('[PhotoUpload] Converting base64 data URI to temp file...');
    const match = photoUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid base64 data URI format');
    }
    const base64Data = match[2] ?? '';
    const tempPath = `${FileSystem.cacheDirectory}upload_b64_${Date.now()}_${index}.${ext}`;
    await FileSystem.writeAsStringAsync(tempPath, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const info = await FileSystem.getInfoAsync(tempPath);
    if (!info.exists) {
      throw new Error('Failed to write base64 to temp file');
    }
    console.log('[PhotoUpload] Base64 → temp file:', tempPath, 'size:', 'size' in info ? info.size : 'unknown');
    return tempPath;
  }

  if (photoUri.startsWith('file://')) {
    const info = await FileSystem.getInfoAsync(photoUri);
    if (info.exists) {
      console.log('[PhotoUpload] File exists:', photoUri, 'size:', 'size' in info ? info.size : 'unknown');
      return photoUri;
    }
    throw new Error('File does not exist: ' + photoUri.substring(0, 80));
  }

  if (photoUri.startsWith('content://') || photoUri.startsWith('ph://')) {
    console.log('[PhotoUpload] Copying content/ph URI to cache...');
    const cachePath = `${FileSystem.cacheDirectory}upload_copy_${Date.now()}_${index}.${ext}`;
    await FileSystem.copyAsync({ from: photoUri, to: cachePath });
    const info = await FileSystem.getInfoAsync(cachePath);
    if (info.exists) {
      console.log('[PhotoUpload] Copied to:', cachePath, 'size:', 'size' in info ? info.size : 'unknown');
      return cachePath;
    }
    throw new Error('Failed to copy content URI to cache');
  }

  throw new Error('Unsupported URI scheme: ' + photoUri.substring(0, 30));
}

async function uploadViaFileSystemMultipart(
  fileUri: string,
  filePath: string,
  mimeType: string,
): Promise<{ success: boolean; error?: string }> {
  const uploadUrl = buildUploadUrl(filePath);
  const headers = await getAuthHeaders();

  console.log('[PhotoUpload] MULTIPART upload to:', uploadUrl.substring(0, 120));
  console.log('[PhotoUpload] File:', fileUri.substring(0, 100), 'mime:', mimeType);

  try {
    const result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      headers,
    });

    console.log('[PhotoUpload] MULTIPART status:', result.status, 'body:', result.body?.substring(0, 200));

    if (result.status >= 200 && result.status < 300) {
      return { success: true };
    }

    let errorMsg = `HTTP ${result.status}`;
    try {
      const parsed = JSON.parse(result.body);
      errorMsg = parsed?.error || parsed?.message || parsed?.statusCode || errorMsg;
    } catch {
      if (result.body) errorMsg = result.body.substring(0, 200);
    }
    return { success: false, error: String(errorMsg) };
  } catch (err) {
    const msg = (err as Error)?.message || 'MULTIPART upload exception';
    console.log('[PhotoUpload] MULTIPART exception:', msg);
    return { success: false, error: msg };
  }
}

async function uploadViaFileSystemBinary(
  fileUri: string,
  filePath: string,
  mimeType: string,
): Promise<{ success: boolean; error?: string }> {
  const uploadUrl = buildUploadUrl(filePath);
  const headers = await getAuthHeaders();
  headers['Content-Type'] = mimeType;

  console.log('[PhotoUpload] BINARY upload to:', uploadUrl.substring(0, 120));

  try {
    const result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    });

    console.log('[PhotoUpload] BINARY status:', result.status, 'body:', result.body?.substring(0, 200));

    if (result.status >= 200 && result.status < 300) {
      return { success: true };
    }

    let errorMsg = `HTTP ${result.status}`;
    try {
      const parsed = JSON.parse(result.body);
      errorMsg = parsed?.error || parsed?.message || parsed?.statusCode || errorMsg;
    } catch {
      if (result.body) errorMsg = result.body.substring(0, 200);
    }
    return { success: false, error: String(errorMsg) };
  } catch (err) {
    const msg = (err as Error)?.message || 'BINARY upload exception';
    console.log('[PhotoUpload] BINARY exception:', msg);
    return { success: false, error: msg };
  }
}

async function handleBucketError(errorMsg: string): Promise<boolean> {
  const isBucketError = errorMsg.includes('Bucket not found') ||
    errorMsg.includes('not found') ||
    errorMsg.includes('bucket') ||
    errorMsg.includes('does not exist');

  if (!isBucketError) return false;

  console.log('[PhotoUpload] Bucket missing — forcing re-creation...');
  _bucketReady = false;

  const rpcCreated = await ensureBucketViaRPC();
  const created = rpcCreated || await ensureBucketViaBackend() || await ensureBucketViaClient();

  if (created) {
    _bucketReady = true;
    await delay(500);
    return true;
  }

  return false;
}

async function uploadNativePhoto(
  dealId: string,
  photoUri: string,
  index: number,
): Promise<UploadResult> {
  const { mimeType, ext } = getMimeAndExt(photoUri);

  console.log('[PhotoUpload] Native upload — converting to local file URI...');
  console.log('[PhotoUpload] Input URI type:', photoUri.startsWith('data:') ? 'base64' : photoUri.startsWith('file://') ? 'file://' : photoUri.startsWith('content://') ? 'content://' : photoUri.startsWith('ph://') ? 'ph://' : 'other');

  let localFileUri: string;
  let isTempFile = false;

  try {
    localFileUri = await ensureLocalFileUri(photoUri, index);
    isTempFile = localFileUri !== photoUri;
  } catch (err) {
    const msg = (err as Error)?.message || 'Failed to prepare file';
    console.log('[PhotoUpload] ensureLocalFileUri FAILED:', msg);
    return { url: null, error: msg };
  }

  const cleanupTemp = async () => {
    if (isTempFile) {
      try { await FileSystem.deleteAsync(localFileUri, { idempotent: true }); } catch {}
    }
  };

  const bucketOk = await ensureBucketExists();
  if (!bucketOk) {
    console.log('[PhotoUpload] WARNING: Bucket not confirmed — attempting upload anyway...');
  }

  const filePath1 = generateFilePath(dealId, index, ext);
  const result1 = await uploadViaFileSystemMultipart(localFileUri, filePath1, mimeType);

  if (result1.success) {
    await cleanupTemp();
    return getPublicUrl(filePath1);
  }

  console.log('[PhotoUpload] MULTIPART failed:', result1.error);

  if (result1.error && await handleBucketError(result1.error)) {
    console.log('[PhotoUpload] Bucket recreated — retrying MULTIPART...');
    const retryPath = generateFilePath(dealId, index, ext);
    const retry = await uploadViaFileSystemMultipart(localFileUri, retryPath, mimeType);
    if (retry.success) {
      await cleanupTemp();
      return getPublicUrl(retryPath);
    }
    console.log('[PhotoUpload] MULTIPART retry after bucket fix failed:', retry.error);
  }

  console.log('[PhotoUpload] Trying BINARY upload type as fallback...');
  const filePath2 = generateFilePath(dealId, index, ext);
  const result2 = await uploadViaFileSystemBinary(localFileUri, filePath2, mimeType);

  if (result2.success) {
    await cleanupTemp();
    return getPublicUrl(filePath2);
  }

  console.log('[PhotoUpload] BINARY fallback also failed:', result2.error);
  await cleanupTemp();

  const errorMsg = result1.error ?? result2.error ?? 'Native upload failed';
  if (errorMsg.includes('security policy') || errorMsg.includes('row-level security') || errorMsg.includes('policy') || errorMsg.includes('Unauthorized') || errorMsg.includes('403')) {
    return { url: null, error: 'Upload denied by storage policy. Run the storage policies SQL from supabase-master.sql.' };
  }

  return { url: null, error: errorMsg };
}

async function compressOnWeb(blob: Blob, mimeType: string): Promise<{ blob: Blob; mimeType: string }> {
  if (Platform.OS !== 'web') return { blob, mimeType };
  try {
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width;
    let h = bitmap.height;
    console.log('[PhotoUpload] Web original dimensions:', w, 'x', h, 'size:', (blob.size / 1024).toFixed(0), 'KB');

    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      console.log('[PhotoUpload] Web scaled to:', w, 'x', h);
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob, mimeType };
    ctx.drawImage(bitmap, 0, 0, w, h);

    let compressed = await canvas.convertToBlob({ type: 'image/jpeg', quality: COMPRESSION_QUALITY_WEB });
    console.log('[PhotoUpload] Web compress:', (blob.size / 1024).toFixed(0), 'KB ->', (compressed.size / 1024).toFixed(0), 'KB at', w, 'x', h);

    if (compressed.size > MAX_WEB_SIZE_KB * 1024) {
      const retryW = Math.round(w * COMPRESSION_RETRY_DIM_FACTOR);
      const retryH = Math.round(h * COMPRESSION_RETRY_DIM_FACTOR);
      const retryCanvas = new OffscreenCanvas(retryW, retryH);
      const retryCtx = retryCanvas.getContext('2d');
      if (retryCtx) {
        retryCtx.drawImage(bitmap, 0, 0, retryW, retryH);
        compressed = await retryCanvas.convertToBlob({ type: 'image/jpeg', quality: COMPRESSION_QUALITY_WEB_RETRY });
        console.log('[PhotoUpload] Web re-compress:', (compressed.size / 1024).toFixed(0), 'KB at', retryW, 'x', retryH);
      }
    }
    bitmap.close();
    return { blob: compressed, mimeType: 'image/jpeg' };
  } catch (err) {
    console.log('[PhotoUpload] Web compression failed:', (err as Error)?.message);
    return { blob, mimeType };
  }
}

async function uploadWebPhoto(
  dealId: string,
  photoUri: string,
  index: number,
): Promise<UploadResult> {
  let blob: Blob;
  let detectedMime = 'image/jpeg';

  if (photoUri.startsWith('data:image/')) {
    const match = photoUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      return { url: null, error: 'Invalid base64 data URI' };
    }
    detectedMime = match[1] ?? 'image/jpeg';
    const raw = atob(match[2] ?? '');
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      arr[i] = raw.charCodeAt(i);
    }
    blob = new Blob([arr], { type: detectedMime });
  } else {
    const response = await fetch(photoUri);
    blob = await response.blob();
    detectedMime = blob.type || detectedMime;
  }

  const compressed = await compressOnWeb(blob, detectedMime);
  blob = compressed.blob;
  const webMime = compressed.mimeType;
  const webExt = webMime.includes('png') ? 'png' : 'jpg';
  const webPath = generateFilePath(dealId, index, webExt);

  console.log('[PhotoUpload] Web: uploading blob, size:', blob.size, 'type:', webMime);

  const bucketOk = await ensureBucketExists();
  if (!bucketOk) {
    console.log('[PhotoUpload] WARNING: Bucket not confirmed — attempting web upload anyway...');
  }

  const uploadUrl = buildUploadUrl(webPath);
  const headers = await getAuthHeaders();
  headers['Content-Type'] = webMime;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: blob,
  });

  if (response.ok) {
    return getPublicUrl(webPath);
  }

  const responseText = await response.text();
  console.log('[PhotoUpload] Web upload failed:', response.status, responseText.substring(0, 200));

  if (await handleBucketError(responseText)) {
    const retryPath = generateFilePath(dealId, index, webExt);
    const retryUrl = buildUploadUrl(retryPath);
    const retryResp = await fetch(retryUrl, {
      method: 'POST',
      headers,
      body: blob,
    });
    if (retryResp.ok) {
      return getPublicUrl(retryPath);
    }
  }

  return { url: null, error: `Web upload failed (HTTP ${response.status}): ${responseText.substring(0, 150)}` };
}

async function checkNetworkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const supabaseUrl = resolveSupabaseUrl();
    if (!supabaseUrl) return true;
    const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'apikey': resolveSupabaseAnonKey() },
    });
    clearTimeout(timeout);
    return resp.ok || resp.status === 400 || resp.status === 401;
  } catch {
    return false;
  }
}

export async function uploadDealPhoto(
  dealId: string,
  photoUri: string,
  index: number,
): Promise<UploadResult> {
  console.log('[PhotoUpload] === START upload photo', index, 'for deal:', dealId);
  console.log('[PhotoUpload] Platform:', Platform.OS);
  console.log('[PhotoUpload] URI type:', photoUri.startsWith('data:') ? 'base64' : photoUri.startsWith('file://') ? 'file://' : photoUri.startsWith('content://') ? 'content://' : photoUri.startsWith('http') ? 'http' : 'other');
  console.log('[PhotoUpload] URI preview:', photoUri.length > 120 ? photoUri.substring(0, 80) + '...[' + photoUri.length + ' chars]' : photoUri);

  if ((photoUri.startsWith('https://') || photoUri.startsWith('http://')) && !photoUri.startsWith('blob:')) {
    console.log('[PhotoUpload] Already a hosted URL, skipping upload');
    return { url: photoUri, error: null };
  }

  const isConnected = await checkNetworkConnectivity();
  if (!isConnected && Platform.OS !== 'web') {
    console.log('[PhotoUpload] OFFLINE — queueing photo for later upload');
    await queueFailedUploads(dealId, [photoUri]);
    return { url: null, error: 'offline_queued' };
  }

  try {
    const result = await retryWithBackoff(async () => {
      if (Platform.OS !== 'web') {
        return await uploadNativePhoto(dealId, photoUri, index);
      } else {
        return await uploadWebPhoto(dealId, photoUri, index);
      }
    }, `Photo ${index}`);

    if (result.error) {
      console.log('[PhotoUpload] === FAILED:', result.error);
    } else {
      console.log('[PhotoUpload] === COMPLETE for photo', index);
    }
    return result;
  } catch (err) {
    const message = (err as Error)?.message || 'Upload failed';
    console.log('[PhotoUpload] === EXCEPTION:', message);

    if (Platform.OS !== 'web') {
      console.log('[PhotoUpload] Queueing failed photo for offline retry...');
      await queueFailedUploads(dealId, [photoUri]);
    }

    return { url: null, error: message };
  }
}

async function uploadBatch(
  dealId: string,
  uris: string[],
  startIndex: number,
  _onProgress?: (info: UploadProgressInfo) => void,
  onSingleComplete?: (index: number, result: UploadResult) => void,
): Promise<{ urls: string[]; errors: string[] }> {
  const urls: string[] = [];
  const errors: string[] = [];

  const promises = uris.map(async (uri, i) => {
    const globalIndex = startIndex + i;
    _onProgress?.({ current: globalIndex + 1, total: 0, status: 'uploading' });

    const result = await uploadDealPhoto(dealId, uri, globalIndex);
    if (result.url) {
      urls.push(result.url);
      console.log('[PhotoUpload] Batch: photo', globalIndex, 'OK');
    } else {
      errors.push(result.error ?? 'Unknown error');
      console.log('[PhotoUpload] Batch: photo', globalIndex, 'FAILED:', result.error);
    }
    onSingleComplete?.(globalIndex, result);
  });

  await Promise.all(promises);
  return { urls, errors };
}

export async function uploadDealPhotosParallel(
  dealId: string,
  photoUris: string[],
  onPhotoComplete?: (index: number, result: UploadResult, completedCount: number, total: number) => void,
): Promise<{ urls: string[]; failedCount: number; errors: string[] }> {
  const STOCK_DOMAINS = ['unsplash.com', 'images.unsplash.com', 'source.unsplash.com', 'pexels.com', 'images.pexels.com', 'pixabay.com', 'stocksnap.io', 'picsum.photos', 'placehold.co', 'via.placeholder.com', 'placekitten.com', 'loremflickr.com', 'dummyimage.com', 'fakeimg.pl'];
  const isStockUrl = (url: string) => STOCK_DOMAINS.some(d => url.toLowerCase().includes(d));
  const isHostedUrl = (p: string) => (p.startsWith('https://') || p.startsWith('http://')) && !p.startsWith('blob:');
  const isLocal = (p: string) => p.startsWith('file://') || p.startsWith('content://') || p.startsWith('blob:') || p.startsWith('data:image/') || p.startsWith('ph://');

  console.log('[PhotoUpload] === PARALLEL UPLOAD START for', photoUris.length, 'photos ===');

  const isConnected = await checkNetworkConnectivity();
  if (!isConnected && Platform.OS !== 'web') {
    console.log('[PhotoUpload] OFFLINE — queueing all photos for later');
    const localPhotos = photoUris.filter(p => isLocal(p));
    if (localPhotos.length > 0) {
      await queueFailedUploads(dealId, localPhotos);
    }
    const remotePhotos = photoUris.filter(p => isHostedUrl(p) && !isStockUrl(p));
    return {
      urls: remotePhotos,
      failedCount: localPhotos.length,
      errors: localPhotos.map(() => 'offline_queued'),
    };
  }

  const bucketPromise = ensureBucketExists();

  const remotePhotos = photoUris.filter(p => {
    if (isLocal(p)) return false;
    if (!isHostedUrl(p)) return false;
    if (isStockUrl(p)) return false;
    return true;
  });

  const localPhotos = photoUris.filter(p => isLocal(p));
  console.log('[PhotoUpload] Parallel: remote:', remotePhotos.length, 'local:', localPhotos.length);

  await bucketPromise;

  const allUrls: string[] = [...remotePhotos];
  const allErrors: string[] = [];
  let completed = 0;
  const total = localPhotos.length;

  for (let batchStart = 0; batchStart < localPhotos.length; batchStart += CONCURRENT_UPLOADS) {
    const batch = localPhotos.slice(batchStart, batchStart + CONCURRENT_UPLOADS);

    const { urls, errors } = await uploadBatch(
      dealId, batch, allUrls.length + batchStart, undefined,
      (idx, result) => {
        completed++;
        onPhotoComplete?.(idx, result, completed, total);
      },
    );
    allUrls.push(...urls);
    allErrors.push(...errors);
  }

  const nonQueuedErrors = allErrors.filter(e => e !== 'offline_queued');
  if (nonQueuedErrors.length > 0 && Platform.OS !== 'web') {
    const failedLocalUris = localPhotos.filter((uri, i) => {
      const batchIdx = Math.floor(i / CONCURRENT_UPLOADS);
      const withinBatch = i % CONCURRENT_UPLOADS;
      const checkUri = localPhotos[batchIdx * CONCURRENT_UPLOADS + withinBatch];
      return checkUri && !allUrls.includes(checkUri);
    });
    if (failedLocalUris.length > 0) {
      await queueFailedUploads(dealId, failedLocalUris);
    }
  }

  console.log('[PhotoUpload] Parallel complete:', allUrls.length, 'URLs,', allErrors.length, 'failed');
  return { urls: allUrls, failedCount: allErrors.length, errors: allErrors };
}

export async function uploadAllDealPhotos(
  dealId: string,
  photos: string[],
  onProgress?: (current: number, total: number, detail?: string) => void,
): Promise<{ urls: string[]; failedCount: number; errors: string[] }> {
  const STOCK_DOMAINS = ['unsplash.com', 'images.unsplash.com', 'source.unsplash.com', 'pexels.com', 'images.pexels.com', 'pixabay.com', 'stocksnap.io', 'picsum.photos', 'placehold.co', 'via.placeholder.com', 'placekitten.com', 'loremflickr.com', 'dummyimage.com', 'fakeimg.pl'];
  const isStockUrl = (url: string) => STOCK_DOMAINS.some(d => url.toLowerCase().includes(d));
  const isHostedUrl = (p: string) => (p.startsWith('https://') || p.startsWith('http://')) && !p.startsWith('blob:');
  const isLocal = (p: string) => p.startsWith('file://') || p.startsWith('content://') || p.startsWith('blob:') || p.startsWith('data:image/') || p.startsWith('ph://');

  console.log('[PhotoUpload] === PRE-FLIGHT: ensuring bucket exists before batch upload...');
  await ensureBucketExists();

  const allUrls: string[] = [];
  const allErrors: string[] = [];

  const remotePhotos = photos.filter(p => {
    if (isLocal(p)) return false;
    if (!isHostedUrl(p)) return false;
    if (isStockUrl(p)) {
      console.log('[PhotoUpload] BLOCKED stock photo:', p.substring(0, 80));
      return false;
    }
    return true;
  });
  allUrls.push(...remotePhotos);

  const localPhotos = photos.filter(p => isLocal(p));
  console.log('[PhotoUpload] uploadAll — remote:', remotePhotos.length, 'local:', localPhotos.length, 'total:', photos.length);

  for (let batchStart = 0; batchStart < localPhotos.length; batchStart += CONCURRENT_UPLOADS) {
    const batchEnd = Math.min(batchStart + CONCURRENT_UPLOADS, localPhotos.length);
    const batch = localPhotos.slice(batchStart, batchEnd);
    onProgress?.(batchStart + 1, localPhotos.length, `Uploading ${batchStart + 1}-${batchEnd} of ${localPhotos.length}...`);

    const { urls, errors } = await uploadBatch(dealId, batch, allUrls.length + batchStart);
    allUrls.push(...urls);
    allErrors.push(...errors);
  }

  console.log('[PhotoUpload] uploadAll complete:', allUrls.length, 'URLs,', allErrors.length, 'failed');
  return { urls: allUrls, failedCount: allErrors.length, errors: allErrors };
}

async function queueFailedUploads(dealId: string, uris: string[]): Promise<void> {
  try {
    const cachedUris: string[] = [];

    if (Platform.OS === 'web') return;

    for (const uri of uris) {
      if (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('ph://')) {
        try {
          const ext = getMimeAndExt(uri).ext;
          const cachePath = `${FileSystem.cacheDirectory}queued_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
          await FileSystem.copyAsync({ from: uri, to: cachePath });
          const info = await FileSystem.getInfoAsync(cachePath);
          if (info.exists) {
            cachedUris.push(cachePath);
            console.log('[PhotoUpload] Queued: cached file for offline retry:', cachePath);
          }
        } catch (copyErr) {
          console.log('[PhotoUpload] Queued: could not cache file:', uri, (copyErr as Error)?.message);
        }
      } else if (uri.startsWith('data:image/')) {
        try {
          const match = uri.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            const ext = getMimeAndExt(uri).ext;
            const cachePath = `${FileSystem.cacheDirectory}queued_b64_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
            await FileSystem.writeAsStringAsync(cachePath, match[2] ?? '', {
              encoding: FileSystem.EncodingType.Base64,
            });
            const info = await FileSystem.getInfoAsync(cachePath);
            if (info.exists) {
              cachedUris.push(cachePath);
              console.log('[PhotoUpload] Queued: base64 cached for offline retry:', cachePath);
            }
          }
        } catch (b64Err) {
          console.log('[PhotoUpload] Queued: could not cache base64:', (b64Err as Error)?.message);
        }
      }
    }

    if (cachedUris.length === 0) return;

    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: QueuedUpload[] = existing ? JSON.parse(existing) : [];
    cachedUris.forEach((localUri, i) => {
      queue.push({ dealId, localUri, index: i, queuedAt: Date.now() });
    });
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log('[PhotoUpload] Queued', cachedUris.length, 'photos for offline retry. Total queue:', queue.length);
  } catch (err) {
    console.log('[PhotoUpload] Failed to queue uploads:', (err as Error)?.message);
  }
}

export async function retryQueuedUploads(
  onResult?: (dealId: string, result: UploadResult) => void,
): Promise<{ succeeded: number; failed: number }> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return { succeeded: 0, failed: 0 };

    const queue: QueuedUpload[] = JSON.parse(raw);
    if (queue.length === 0) return { succeeded: 0, failed: 0 };

    const isConnected = await checkNetworkConnectivity();
    if (!isConnected) {
      console.log('[PhotoUpload] Still offline — skipping queue retry');
      return { succeeded: 0, failed: queue.length };
    }

    console.log('[PhotoUpload] Retrying', queue.length, 'queued uploads...');

    let succeeded = 0;
    let failed = 0;
    const remaining: QueuedUpload[] = [];

    for (const item of queue) {
      if (Platform.OS !== 'web') {
        const info = await FileSystem.getInfoAsync(item.localUri);
        if (!info.exists) {
          console.log('[PhotoUpload] Queued file no longer exists:', item.localUri);
          continue;
        }
      }

      const result = await uploadDealPhoto(item.dealId, item.localUri, item.index);
      if (result.url) {
        succeeded++;
        if (Platform.OS !== 'web') {
          try { await FileSystem.deleteAsync(item.localUri, { idempotent: true }); } catch {}
        }
        onResult?.(item.dealId, result);
      } else if (result.error === 'offline_queued') {
        remaining.push(item);
        failed++;
      } else {
        failed++;
        if (Date.now() - item.queuedAt < 24 * 60 * 60 * 1000) {
          remaining.push(item);
        } else {
          console.log('[PhotoUpload] Dropping stale queued upload (>24h):', item.localUri);
          if (Platform.OS !== 'web') {
            try { await FileSystem.deleteAsync(item.localUri, { idempotent: true }); } catch {}
          }
        }
      }
    }

    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    console.log('[PhotoUpload] Queue retry complete:', succeeded, 'succeeded,', failed, 'failed,', remaining.length, 'remaining');
    return { succeeded, failed };
  } catch (err) {
    console.log('[PhotoUpload] retryQueuedUploads error:', (err as Error)?.message);
    return { succeeded: 0, failed: 0 };
  }
}

export async function getQueuedUploadCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return 0;
    const queue: QueuedUpload[] = JSON.parse(raw);
    return queue.length;
  } catch {
    return 0;
  }
}

export function resetBucketCache(): void {
  _bucketReady = false;
  _bucketCheckPromise = null;
  _lastBucketError = '';
  console.log('[PhotoUpload] Bucket cache reset — will re-check on next upload');
}

export function getLastBucketError(): string {
  return _lastBucketError;
}
