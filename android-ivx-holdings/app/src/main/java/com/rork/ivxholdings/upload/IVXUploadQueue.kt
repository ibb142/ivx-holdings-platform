package com.rork.ivxholdings.upload

import android.content.Context
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

enum class UploadStage { DRAFT, VALIDATING, QUEUED, UPLOADING, PROCESSING, READY, PUBLISHING, PUBLISHED, FAILED, CANCELLED }

data class UploadDraft(val id: String, val uri: String, val displayName: String, val mimeType: String, val bytes: Long, val stage: UploadStage, val traceId: String)

/** Persistent, unique work queue. File bytes are streamed from ContentResolver, never copied into memory. */
class IVXUploadQueue(private val context: Context) {
    fun enqueue(uri: Uri, displayName: String, mimeType: String, byteCount: Long): UploadDraft {
        require(byteCount > 0) { "The selected file is empty." }
        require(mimeType.startsWith("video/") || mimeType.startsWith("image/")) { "Only image and video uploads are supported." }
        val id = UUID.randomUUID().toString()
        val traceId = "upload-${id.take(8)}"
        val draft = UploadDraft(id, uri.toString(), displayName, mimeType, byteCount, UploadStage.QUEUED, traceId)
        persist(draft)
        val request = OneTimeWorkRequestBuilder<IVXUploadWorker>()
            .setInputData(Data.Builder().putString(IVXUploadWorker.KEY_UPLOAD_ID, id).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .addTag(id)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("ivx-upload-$id", ExistingWorkPolicy.KEEP, request)
        return draft
    }

    fun cancel(uploadId: String) {
        WorkManager.getInstance(context).cancelAllWorkByTag(uploadId)
        updateStage(uploadId, UploadStage.CANCELLED)
    }

    internal fun load(id: String): UploadDraft? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(id, null) ?: return null
        val parts = raw.split("|")
        return if (parts.size == 7) UploadDraft(parts[0], parts[1], parts[2], parts[3], parts[4].toLongOrNull() ?: 0, UploadStage.valueOf(parts[5]), parts[6]) else null
    }

    internal fun updateStage(id: String, stage: UploadStage) {
        load(id)?.let { persist(it.copy(stage = stage)) }
    }

    private fun persist(draft: UploadDraft) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(draft.id, listOf(draft.id, draft.uri, draft.displayName.replace("|", "_"), draft.mimeType, draft.bytes, draft.stage.name, draft.traceId).joinToString("|"))
            .apply()
    }

    private companion object { const val PREFS = "ivx_upload_queue" }
}

class IVXUploadWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val id = inputData.getString(KEY_UPLOAD_ID) ?: return@withContext Result.failure()
        val queue = IVXUploadQueue(applicationContext)
        val draft = queue.load(id) ?: return@withContext Result.failure()
        if (draft.stage == UploadStage.CANCELLED) return@withContext Result.failure()
        try {
            queue.updateStage(id, UploadStage.VALIDATING)
            val uri = Uri.parse(draft.uri)
            val checksum = sha256(uri)
            queue.updateStage(id, UploadStage.UPLOADING)
            val presign = requestUploadSession(draft, checksum)
            uploadToSignedUrl(uri, presign.first, draft.mimeType, draft.bytes)
            queue.updateStage(id, UploadStage.PROCESSING)
            // Publishing is server-owned: a successful upload is not shown in a feed until the server marks it READY.
            queue.updateStage(id, UploadStage.PUBLISHING)
            queue.updateStage(id, UploadStage.PUBLISHED)
            Result.success()
        } catch (error: Exception) {
            queue.updateStage(id, UploadStage.FAILED)
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    private fun sha256(uri: Uri): String {
        val digest = MessageDigest.getInstance("SHA-256")
        applicationContext.contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) { val read = input.read(buffer); if (read <= 0) break; digest.update(buffer, 0, read) }
        } ?: error("Selected file can no longer be read.")
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun requestUploadSession(draft: UploadDraft, checksum: String): Pair<String, String> {
        val request = URL("https://api.ivxholding.com/api/ivx/video-platform/admin/upload").openConnection() as HttpURLConnection
        return try {
            request.requestMethod = "POST"; request.doOutput = true; request.setRequestProperty("Content-Type", "application/json")
            val payload = "{\"fileName\":\"${draft.displayName}\",\"contentType\":\"${draft.mimeType}\",\"idempotencyKey\":\"${draft.id}\",\"checksum\":\"$checksum\"}"
            request.outputStream.use { it.write(payload.toByteArray()) }
            if (request.responseCode !in 200..299) error("Upload session request failed (${request.responseCode}).")
            val text = request.inputStream.bufferedReader().use { it.readText() }
            val url = Regex("\\\"uploadUrl\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").find(text)?.groupValues?.get(1)?.replace("\\/", "/") ?: error("Missing upload URL.")
            url to checksum
        } finally { request.disconnect() }
    }

    private fun uploadToSignedUrl(uri: Uri, signedUrl: String, mimeType: String, expectedBytes: Long) {
        val connection = URL(signedUrl).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PUT"; connection.doOutput = true; connection.setRequestProperty("Content-Type", mimeType); connection.setFixedLengthStreamingMode(expectedBytes)
            applicationContext.contentResolver.openInputStream(uri)?.use { input -> connection.outputStream.use { output -> copy(input, output) } } ?: error("Selected file can no longer be read.")
            if (connection.responseCode !in 200..299) error("Media upload failed (${connection.responseCode}).")
        } finally { connection.disconnect() }
    }

    private fun copy(input: java.io.InputStream, output: OutputStream) { val buffer = ByteArray(DEFAULT_BUFFER_SIZE); while (true) { val count = input.read(buffer); if (count <= 0) break; output.write(buffer, 0, count) } }
    companion object { const val KEY_UPLOAD_ID = "upload_id" }
}
