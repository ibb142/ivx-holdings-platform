/**
 * media-native-processing — native media processing pipeline.
 *
 * Integrates the four SDK-54 packages required by the FINAL MEDIA
 * CERTIFICATION work order:
 *   - expo-image-manipulator  → native image resize/compress (replaces web-only canvas path)
 *   - expo-media-library      → save processed media to device camera roll
 *   - expo-background-fetch   → register periodic background upload-retry task
 *   - expo-task-manager       → define the background upload-retry task body
 *
 * Every public function degrades gracefully on web (where these native
 * modules are no-ops) so the existing web pipeline in photo-upload.ts
 * remains the source of truth for browser uploads.
 */
import { Platform } from 'react-native';

// Lazily import native-only modules so web builds never evaluate them.
// `require` is gated behind Platform.OS so the bundler does not attempt
// to resolve native code in a web target.
type ImageManipulatorStatic = typeof import('expo-image-manipulator');
type MediaLibraryStatic = typeof import('expo-media-library');
type BackgroundFetchStatic = typeof import('expo-background-fetch');
type TaskManagerStatic = typeof import('expo-task-manager');

let _imageManipulator: ImageManipulatorStatic | null = null;
let _mediaLibrary: MediaLibraryStatic | null = null;
let _backgroundFetch: BackgroundFetchStatic | null = null;
let _taskManager: TaskManagerStatic | null = null;

function getImageManipulator(): ImageManipulatorStatic | null {
  if (Platform.OS === 'web') return null;
  if (!_imageManipulator) {
    _imageManipulator = require('expo-image-manipulator');
  }
  return _imageManipulator;
}

function getMediaLibrary(): MediaLibraryStatic | null {
  if (Platform.OS === 'web') return null;
  if (!_mediaLibrary) {
    _mediaLibrary = require('expo-media-library');
  }
  return _mediaLibrary;
}

function getBackgroundFetch(): BackgroundFetchStatic | null {
  if (Platform.OS === 'web') return null;
  if (!_backgroundFetch) {
    _backgroundFetch = require('expo-background-fetch');
  }
  return _backgroundFetch;
}

function getTaskManager(): TaskManagerStatic | null {
  if (Platform.OS === 'web') return null;
  if (!_taskManager) {
    _taskManager = require('expo-task-manager');
  }
  return _taskManager;
}

// ---------------------------------------------------------------------------
// Image processing (expo-image-manipulator)
// ---------------------------------------------------------------------------

export interface NativeImageProcessOptions {
  maxDimension?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

export interface NativeImageProcessResult {
  uri: string;
  width: number;
  height: number;
  sizeBytes: number | null;
}

const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_QUALITY = 0.92;
const DEFAULT_FORMAT: 'jpeg' | 'png' | 'webp' = 'jpeg';

/**
 * Resize + compress a local image URI on native platforms.
 * Returns the processed URI (in cache) plus dimensions when available.
 * On web, returns the input URI unchanged (web compression handled in photo-upload.ts).
 */
export async function processNativeImage(
  inputUri: string,
  options: NativeImageProcessOptions = {},
): Promise<NativeImageProcessResult> {
  if (Platform.OS === 'web') {
    return { uri: inputUri, width: 0, height: 0, sizeBytes: null };
  }

  const manipulator = getImageManipulator();
  if (!manipulator) {
    return { uri: inputUri, width: 0, height: 0, sizeBytes: null };
  }

  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const format = options.format ?? DEFAULT_FORMAT;

  // Read original dimensions via the manipulator's ImageManipulator.manipulateAsync.
  // actions: resize to maxDimension (preserves aspect ratio), then export.
  const actions: Array<{ resize: { width?: number; height?: number } }> = [];
  // We resize by the larger axis; manipulator handles aspect ratio.
  actions.push({ resize: { width: maxDimension, height: maxDimension } });

  try {
    const result = await manipulator.manipulateAsync(inputUri, actions, {
      compress: quality,
      format: format as any,
    });
    return {
      uri: result.uri,
      width: result.width ?? 0,
      height: result.height ?? 0,
      // expo-image-manipulator does not expose size; caller can stat the URI.
      sizeBytes: null,
    };
  } catch (err) {
    const msg = (err as Error)?.message || 'manipulateAsync failed';
    console.log('[MediaNative] processNativeImage failed:', msg);
    // Degrade gracefully — caller falls back to the original URI.
    return { uri: inputUri, width: 0, height: 0, sizeBytes: null };
  }
}

// ---------------------------------------------------------------------------
// Camera roll save (expo-media-library)
// ---------------------------------------------------------------------------

export interface SaveToGalleryResult {
  success: boolean;
  localUri: string | null;
  albumId: string | null;
  error: string | null;
}

/**
 * Save a local media URI to the device camera roll (optional, user-gated).
 * Requests MediaLibraryPermission first; returns success=false on denial.
 */
export async function saveMediaToGallery(
  localUri: string,
  albumName?: string,
): Promise<SaveToGalleryResult> {
  if (Platform.OS === 'web') {
    return { success: false, localUri: null, albumId: null, error: 'web_unsupported' };
  }

  const mediaLibrary = getMediaLibrary();
  if (!mediaLibrary) {
    return { success: false, localUri: null, albumId: null, error: 'module_unavailable' };
  }

  try {
    const { status } = await mediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return { success: false, localUri: null, albumId: null, error: 'permission_denied' };
    }

    const asset = await mediaLibrary.createAssetAsync(localUri);

    if (albumName) {
      const album = await mediaLibrary.getAlbumAsync(albumName);
      if (album) {
        await mediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await mediaLibrary.createAlbumAsync(albumName, asset, false);
      }
    }

    return {
      success: true,
      localUri: asset.uri,
      albumId: asset.albumId ?? null,
      error: null,
    };
  } catch (err) {
    const msg = (err as Error)?.message || 'createAssetAsync failed';
    console.log('[MediaNative] saveMediaToGallery failed:', msg);
    return { success: false, localUri: null, albumId: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Background upload retry (expo-background-fetch + expo-task-manager)
// ---------------------------------------------------------------------------

export const BACKGROUND_UPLOAD_TASK = 'ivx-background-upload-retry';
const BACKGROUND_TASK_MIN_INTERVAL = 15; // minutes (Android minimum)

let _taskRegistered = false;

/**
 * Register the background upload-retry task.
 * The task body calls into the existing retryQueuedUploads pipeline in
 * photo-upload.ts via a module-level callback registered by the app shell.
 *
 * Returns true if the task was registered (or was already registered).
 */
export async function registerBackgroundUploadRetryTask(
  onRun: () => Promise<void>,
): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const taskManager = getTaskManager();
  const backgroundFetch = getBackgroundFetch();
  if (!taskManager || !backgroundFetch) return false;

  if (_taskRegistered) return true;

  try {
    // Define the task body first — TaskManager requires this before register.
    taskManager.defineTask(BACKGROUND_UPLOAD_TASK, async () => {
      try {
        await onRun();
        return backgroundFetch.BackgroundFetchResult.NewData;
      } catch (err) {
        console.log(
          '[MediaNative] background upload retry failed:',
          (err as Error)?.message,
        );
        return backgroundFetch.BackgroundFetchResult.Failed;
      }
    });

    await backgroundFetch.registerTaskAsync(BACKGROUND_UPLOAD_TASK, {
      minimumInterval: BACKGROUND_TASK_MIN_INTERVAL,
      stopOnTerminate: false,
      startOnBoot: true,
    });

    _taskRegistered = true;
    console.log('[MediaNative] background upload-retry task registered');
    return true;
  } catch (err) {
    const msg = (err as Error)?.message || 'registerTaskAsync failed';
    console.log('[MediaNative] registerBackgroundUploadRetryTask failed:', msg);
    return false;
  }
}

/**
 * Unregister the background upload-retry task (used by emergency-stop).
 */
export async function unregisterBackgroundUploadRetryTask(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const backgroundFetch = getBackgroundFetch();
  if (!backgroundFetch) return false;

  if (!_taskRegistered) return true;

  try {
    await backgroundFetch.unregisterTaskAsync(BACKGROUND_UPLOAD_TASK);
    _taskRegistered = false;
    console.log('[MediaNative] background upload-retry task unregistered');
    return true;
  } catch (err) {
    const msg = (err as Error)?.message || 'unregisterTaskAsync failed';
    console.log('[MediaNative] unregisterBackgroundUploadRetryTask failed:', msg);
    return false;
  }
}

export function isBackgroundUploadTaskRegistered(): boolean {
  return _taskRegistered;
}